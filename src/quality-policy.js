// SPDX-License-Identifier: GPL-3.0-or-later
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export const QUALITY_POLICY_VERSION="90-94-97-v2";
const QUALITY_ORDER=Object.freeze({standard:0,high:1,max:2});

export const QUALITY_TARGETS=Object.freeze({
  standard:Object.freeze({
    score:90,ssim:.80,hallucination:30,colorDrift:12,lumaDrift:16,alphaDrift:3,
    alphaCoverageDiff:2,cnnAgreement:.65,cnnConfidence:.45,cnnRejectedRatio:.40,edgeGain:2.8,
  }),
  high:Object.freeze({
    score:94,ssim:.85,hallucination:22,colorDrift:9,lumaDrift:12,alphaDrift:2,
    alphaCoverageDiff:1.5,cnnAgreement:.72,cnnConfidence:.55,cnnRejectedRatio:.30,edgeGain:2.5,
  }),
  max:Object.freeze({
    score:97,ssim:.88,hallucination:16,colorDrift:7,lumaDrift:10,alphaDrift:1.5,
    alphaCoverageDiff:1,cnnAgreement:.78,cnnConfidence:.65,cnnRejectedRatio:.22,edgeGain:2.3,
  }),
});

export function qualityTargetFor(detailQuality="standard"){
  return QUALITY_TARGETS[detailQuality]||QUALITY_TARGETS.standard;
}

export function evaluateQuality(metrics={},context={}){
  const detailQuality=["standard","high","max"].includes(context.detailQuality)
    ? context.detailQuality : "standard";
  const target=qualityTargetFor(detailQuality);

  if(metrics?.score===undefined||metrics?.score===null){
    return {
      verdict:"unknown",retry:false,fallback:false,minimumMet:false,
      threshold:target.score,targetScore:target.score,recommendedQuality:null,reasons:["no metrics"],
    };
  }

  const score=Number(metrics.score);
  const reasons=[];
  if(score<target.score)reasons.push(`quality below ${target.score}`);
  if(Number(metrics.colorDrift??0)>target.colorDrift)reasons.push("colour drift");
  if(Number(metrics.lumaDrift??0)>target.lumaDrift)reasons.push("luma drift");
  if(Number(metrics.alphaDrift??0)>target.alphaDrift)reasons.push("alpha drift");
  if(Number(metrics.alphaCoverageDiff??0)>target.alphaCoverageDiff)reasons.push("alpha coverage");
  if(Number(metrics.cnnAgreement??1)<target.cnnAgreement)reasons.push("low CNN agreement");
  if(Number(metrics.cnnConfidence??metrics.cnnAgreement??1)<target.cnnConfidence)reasons.push("low CNN confidence");
  if(Number(metrics.cnnRejectedRatio??0)>target.cnnRejectedRatio)reasons.push("high CNN rejection");
  if(Number(metrics.edgeGain??1)>target.edgeGain)reasons.push("edge amplification");
  if(metrics.ssim!==undefined&&Number(metrics.ssim)<target.ssim)reasons.push("low structural similarity");
  if(Number(metrics.hallucinationScore??0)>target.hallucination)reasons.push("hallucination risk");

  const catastrophic=
    score<60||
    Number(metrics.hallucinationScore??0)>70||
    Number(metrics.alphaCoverageDiff??0)>10||
    (metrics.ssim!==undefined&&Number(metrics.ssim)<.45)||
    Number(metrics.edgeGain??1)>4;

  const minimumMet=score>=target.score;
  const retry=!catastrophic&&(reasons.length>0);
  const fallback=catastrophic;
  const verdict=fallback?"reject":retry?"retry":"pass";

  let recommendedQuality=null;
  if(verdict==="reject")recommendedQuality="no-ai";
  else if(verdict==="retry"){
    recommendedQuality=detailQuality==="max"?"high":"standard";
  }

  return {
    verdict,retry,fallback,minimumMet,
    threshold:target.score,targetScore:target.score,
    detailQuality,recommendedQuality,reasons,
    target,
  };
}

export function highestPassingQuality(metrics={},context={},maxTier="max"){
  const cap=QUALITY_ORDER[maxTier]??QUALITY_ORDER.max;
  for(const tier of ["max","high","standard"]){
    if((QUALITY_ORDER[tier]??0)>cap)continue;
    if(evaluateQuality(metrics,{...context,detailQuality:tier}).verdict==="pass")return tier;
  }
  return null;
}

export function chooseBetterQuality(primary,conservative){
  const a=primary?.metrics?.score??-1;
  const b=conservative?.metrics?.score??-1;
  const ah=primary?.metrics?.hallucinationScore??0;
  const bh=conservative?.metrics?.hallucinationScore??0;
  const as=primary?.metrics?.ssim;
  const bs=conservative?.metrics?.ssim;
  if(bh+12<ah&&b>=a-2)return conservative;
  if(as!==undefined&&bs!==undefined&&bs>as+.08&&b>=a-2)return conservative;
  if(b>a+1)return conservative;
  return primary;
}
