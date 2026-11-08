// SPDX-License-Identifier: GPL-3.0-or-later
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const MATERIAL_BIAS=Object.freeze({
  weapon:4,character:4,terrain:2,stone:2,metal:1,fabric:1,organic:1,energy:1,
  generic:0,glass:-3,sky:-3,ui:-6,normal:-10,mask:-10,
});

const MATERIAL_GUARD=Object.freeze({
  generic:{minConfidence:.34,maxRejected:.62},
  terrain:{minConfidence:.28,maxRejected:.72},
  stone:{minConfidence:.26,maxRejected:.74},
  metal:{minConfidence:.36,maxRejected:.58},
  fabric:{minConfidence:.30,maxRejected:.68},
  organic:{minConfidence:.38,maxRejected:.56},
  character:{minConfidence:.42,maxRejected:.50},
  weapon:{minConfidence:.38,maxRejected:.56},
  energy:{minConfidence:.44,maxRejected:.48},
  glass:{minConfidence:.48,maxRejected:.42},
  sky:{minConfidence:.46,maxRejected:.46},
  ui:{minConfidence:.55,maxRejected:.32},
  normal:{minConfidence:1,maxRejected:0},
  mask:{minConfidence:1,maxRejected:0},
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
  const guard=MATERIAL_GUARD[textureClass]??MATERIAL_GUARD[material]??MATERIAL_GUARD.generic;
  const confidence=metrics.cnnConfidence===undefined?1:Number(metrics.cnnConfidence);
  const rejected=metrics.cnnRejectedRatio===undefined?0:Number(metrics.cnnRejectedRatio);
  const psnr=metrics.psnr===undefined?null:Number(metrics.psnr);
  const reasons=[];
  if(metrics.colorDrift>18)reasons.push("colour drift");
  if(metrics.lumaDrift>22)reasons.push("luma drift");
  if(metrics.alphaDrift>6)reasons.push("alpha drift");
  if(metrics.cnnAgreement<.42)reasons.push("low CNN agreement");
  if(confidence<guard.minConfidence)reasons.push("low CNN confidence");
  if(rejected>guard.maxRejected)reasons.push("high CNN rejection rate");
  if(metrics.edgeGain>3.2)reasons.push("edge amplification");
  if(metrics.histogramDrift>22)reasons.push("histogram drift");
  if(metrics.alphaCoverageDiff>5)reasons.push("alpha coverage");
  if(metrics.ssim!==undefined&&metrics.ssim<.55)reasons.push("low structural similarity");
  if(metrics.hallucinationScore>65)reasons.push("hallucination risk");
  if(psnr!==null&&psnr<12)reasons.push("extreme reconstruction drift");
  const score=Number(metrics.score);
  const fallback=score<fallbackThreshold||metrics.hallucinationScore>82||metrics.alphaCoverageDiff>18||
    confidence<Math.max(.10,guard.minConfidence*.45)||rejected>.94||(psnr!==null&&psnr<8);
  const retry=!fallback&&(score<retryThreshold||metrics.hallucinationScore>65||
    confidence<guard.minConfidence||rejected>guard.maxRejected||
    (metrics.ssim!==undefined&&metrics.ssim<.5)||(psnr!==null&&psnr<12));
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
  const ah=primary?.metrics?.hallucinationScore??0;
  const bh=conservative?.metrics?.hallucinationScore??0;
  const as=primary?.metrics?.ssim;
  const bs=conservative?.metrics?.ssim;
  const ac=primary?.metrics?.cnnConfidence??1;
  const bc=conservative?.metrics?.cnnConfidence??1;
  const ar=primary?.metrics?.cnnRejectedRatio??0;
  const br=conservative?.metrics?.cnnRejectedRatio??0;
  if(bh+12<ah&&b>=a-2)return conservative;
  if(bc>ac+.15&&b>=a-2)return conservative;
  if(br+.25<ar&&b>=a-2)return conservative;
  if(as!==undefined&&bs!==undefined&&bs>as+.08&&b>=a-2)return conservative;
  if(b>a+1)return conservative;
  return primary;
}
