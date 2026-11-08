// SPDX-License-Identifier: GPL-3.0-or-later
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const MATERIAL_BIAS=Object.freeze({
  weapon:4,character:4,terrain:2,stone:2,metal:1,fabric:1,organic:1,energy:1,
  generic:0,glass:-3,sky:-3,ui:-6,normal:-10,mask:-10,
});

export function evaluateQuality(metrics={},context={}){
  if(metrics?.score===undefined||metrics?.score===null){
    return {verdict:"unknown",retry:false,fallback:false,threshold:45,recommendedQuality:null,reasons:["no metrics"]};
  }
  const textureClass=context.textureClass||"diffuse";
  const material=context.material||"generic";
  const bias=MATERIAL_BIAS[textureClass]??MATERIAL_BIAS[material]??0;
  const retryThreshold=clamp(48+bias,40,56);
  const fallbackThreshold=clamp(30+bias,24,38);
  const reasons=[];
  if(metrics.colorDrift>18)reasons.push("colour drift");
  if(metrics.lumaDrift>22)reasons.push("luma drift");
  if(metrics.alphaDrift>6)reasons.push("alpha drift");
  if(metrics.cnnAgreement<.42)reasons.push("low CNN agreement");
  if(metrics.edgeGain>3.2)reasons.push("edge amplification");
  if(metrics.histogramDrift>22)reasons.push("histogram drift");
  if(metrics.alphaCoverageDiff>5)reasons.push("alpha coverage");
  if(metrics.ssim!==undefined&&metrics.ssim<.55)reasons.push("low structural similarity");
  if(metrics.hallucinationScore>65)reasons.push("hallucination risk");
  const score=Number(metrics.score);
  const fallback=score<fallbackThreshold||metrics.hallucinationScore>82||metrics.alphaCoverageDiff>18;
  const retry=!fallback&&(score<retryThreshold||metrics.hallucinationScore>65||(metrics.ssim!==undefined&&metrics.ssim<.5));
  const verdict=fallback?"reject":retry?"retry":score<72?"watch":"pass";
  let recommendedQuality=null;
  if(verdict==="reject")recommendedQuality="no-ai";
  else if(verdict==="retry")recommendedQuality="standard";
  else if(verdict==="watch")recommendedQuality=context.detailQuality==="max"?"high":null;
  return {verdict,retry,fallback,threshold:retryThreshold,fallbackThreshold,recommendedQuality,reasons};
}

export function chooseBetterQuality(primary,conservative){
  const a=primary?.metrics?.score??-1;
  const b=conservative?.metrics?.score??-1;
  if(b>a+1)return conservative;
  return primary;
}
