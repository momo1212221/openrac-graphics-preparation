// SPDX-License-Identifier: GPL-3.0-or-later
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export const QUALITY_POLICY_VERSION="90-94-97-v4-regional";
const QUALITY_ORDER=Object.freeze({standard:0,high:1,max:2});

export const QUALITY_TARGETS=Object.freeze({
  standard:Object.freeze({
    score:90,ssim:.80,hallucination:30,colorDrift:12,lumaDrift:16,alphaDrift:3,
    alphaCoverageDiff:2,alphaEdgeCoverageDiff:3,cnnAgreement:.65,cnnConfidence:.45,cnnRejectedRatio:.40,cnnLowConfidenceRatio:.55,cnnConfidenceP10:.12,edgeGain:2.8,
  }),
  high:Object.freeze({
    score:94,ssim:.85,hallucination:22,colorDrift:9,lumaDrift:12,alphaDrift:2,
    alphaCoverageDiff:1.5,alphaEdgeCoverageDiff:2,cnnAgreement:.72,cnnConfidence:.55,cnnRejectedRatio:.30,cnnLowConfidenceRatio:.42,cnnConfidenceP10:.18,edgeGain:2.5,
  }),
  max:Object.freeze({
    score:97,ssim:.88,hallucination:16,colorDrift:7,lumaDrift:10,alphaDrift:1.5,
    alphaCoverageDiff:1,alphaEdgeCoverageDiff:1.5,cnnAgreement:.78,cnnConfidence:.65,cnnRejectedRatio:.22,cnnLowConfidenceRatio:.30,cnnConfidenceP10:.25,edgeGain:2.3,
  }),
});

const MATERIAL_TARGET_ADJUST=Object.freeze({
  terrain:{ssim:-.02,hallucination:4,cnnConfidence:-.08,cnnRejectedRatio:.10,edgeGain:.20},
  stone:{ssim:-.025,hallucination:5,cnnConfidence:-.10,cnnRejectedRatio:.12,edgeGain:.25},
  metal:{ssim:-.005,hallucination:1,cnnConfidence:-.02,cnnRejectedRatio:.03,edgeGain:.05},
  fabric:{ssim:-.015,hallucination:3,cnnConfidence:-.06,cnnRejectedRatio:.08,edgeGain:.15},
  organic:{ssim:.005,hallucination:-1,cnnConfidence:.02,cnnRejectedRatio:-.03,edgeGain:-.05},
  character:{ssim:.02,hallucination:-3,cnnConfidence:.06,cnnRejectedRatio:-.08,edgeGain:-.18},
  weapon:{ssim:.005,hallucination:-1,cnnConfidence:.03,cnnRejectedRatio:-.04,edgeGain:-.08},
  energy:{ssim:.015,hallucination:-4,cnnConfidence:.07,cnnRejectedRatio:-.08,edgeGain:-.20},
  glass:{ssim:.03,hallucination:-5,cnnConfidence:.10,cnnRejectedRatio:-.12,edgeGain:-.30},
  sky:{ssim:.025,hallucination:-5,cnnConfidence:.09,cnnRejectedRatio:-.10,edgeGain:-.25},
  ui:{ssim:.035,hallucination:-6,cnnConfidence:.12,cnnRejectedRatio:-.15,edgeGain:-.35},
});

export function qualityTargetFor(detailQuality="standard",material="generic",textureClass=null){
  const base=QUALITY_TARGETS[detailQuality]||QUALITY_TARGETS.standard;
  const key=textureClass&&MATERIAL_TARGET_ADJUST[textureClass]?textureClass:material;
  const adj=MATERIAL_TARGET_ADJUST[key]||{};
  return Object.freeze({
    ...base,
    ssim:clamp(base.ssim+(adj.ssim||0),0,1),
    hallucination:clamp(base.hallucination+(adj.hallucination||0),0,100),
    cnnConfidence:clamp(base.cnnConfidence+(adj.cnnConfidence||0),0,1),
    cnnRejectedRatio:clamp(base.cnnRejectedRatio+(adj.cnnRejectedRatio||0),0,1),
    edgeGain:Math.max(1,base.edgeGain+(adj.edgeGain||0)),
  });
}

export function evaluateQuality(metrics={},context={}){
  const detailQuality=["standard","high","max"].includes(context.detailQuality)
    ? context.detailQuality : "standard";
  const material=context.material||"generic";
  const textureClass=context.textureClass||"diffuse";
  const target=qualityTargetFor(detailQuality,material,textureClass);

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
  if(Number(metrics.alphaEdgeCoverageDiff??0)>target.alphaEdgeCoverageDiff)reasons.push("alpha edge coverage");
  if(Number(metrics.cnnAgreement??1)<target.cnnAgreement)reasons.push("low CNN agreement");
  if(Number(metrics.cnnConfidence??metrics.cnnAgreement??1)<target.cnnConfidence)reasons.push("low CNN confidence");
  if(Number(metrics.cnnRejectedRatio??0)>target.cnnRejectedRatio)reasons.push("high CNN rejection");
  if(Number(metrics.cnnLowConfidenceRatio??0)>target.cnnLowConfidenceRatio)reasons.push("regional low-confidence area");
  if(Number(metrics.cnnConfidenceP10??1)<target.cnnConfidenceP10)reasons.push("weak regional confidence floor");
  if(Number(metrics.edgeGain??1)>target.edgeGain)reasons.push("edge amplification");
  if(metrics.ssim!==undefined&&Number(metrics.ssim)<target.ssim)reasons.push("low structural similarity");
  if(Number(metrics.hallucinationScore??0)>target.hallucination)reasons.push("hallucination risk");
  if(metrics.psnr!==undefined&&Number(metrics.psnr)<12)reasons.push("extreme reconstruction drift");

  const confidence=Number(metrics.cnnConfidence??metrics.cnnAgreement??1);
  const rejected=Number(metrics.cnnRejectedRatio??0);
  const regionalLow=Number(metrics.cnnLowConfidenceRatio??0);
  const confidenceP10=Number(metrics.cnnConfidenceP10??1);
  const catastrophic=
    score<60||
    Number(metrics.hallucinationScore??0)>70||
    Number(metrics.alphaCoverageDiff??0)>10||
    Number(metrics.alphaEdgeCoverageDiff??0)>12||
    (metrics.ssim!==undefined&&Number(metrics.ssim)<.45)||
    Number(metrics.edgeGain??1)>4||
    confidence<Math.max(.10,target.cnnConfidence*.35)||
    rejected>.94||
    regionalLow>.96||
    confidenceP10<.02||
    (metrics.psnr!==undefined&&Number(metrics.psnr)<8);

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
  const ac=primary?.metrics?.cnnConfidence??1;
  const bc=conservative?.metrics?.cnnConfidence??1;
  const ar=primary?.metrics?.cnnRejectedRatio??0;
  const br=conservative?.metrics?.cnnRejectedRatio??0;
  const al=primary?.metrics?.cnnLowConfidenceRatio??0;
  const bl=conservative?.metrics?.cnnLowConfidenceRatio??0;
  if(bh+12<ah&&b>=a-2)return conservative;
  if(bc>ac+.15&&b>=a-2)return conservative;
  if(br+.25<ar&&b>=a-2)return conservative;
  if(bl+.20<al&&b>=a-2)return conservative;
  if(as!==undefined&&bs!==undefined&&bs>as+.08&&b>=a-2)return conservative;
  if(b>a+1)return conservative;
  return primary;
}
