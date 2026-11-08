// SPDX-License-Identifier: GPL-3.0-or-later
import {pathTextureScope} from "./texture-classify.js";
import {qualityTargetFor} from "./quality-policy.js";

const DETAIL_MATERIALS=new Set(["weapon","character","terrain","stone","metal","fabric"]);
const MAX_PATH=/(ratchet|clank|character|hero|skin|weapon|wrench|blaster|gun|launcher|boss)/i;
const HIGH_PATH=/(enemy|npc|terrain|ground|floor|wall|rock|stone|metal|machine|vehicle|ship|fabric|cloth)/i;

export function automaticDetailQuality(texture={},globalQuality="auto"){
  if(["standard","high","max"].includes(globalQuality))return globalQuality;
  const path=String(texture.path||"");
  const scope=pathTextureScope(path);
  const size=Math.max(0,Number(texture.size)||0);
  if(["ui","normal","mask"].includes(scope))return "standard";
  if(scope==="sky")return "high";
  if(MAX_PATH.test(path))return size>2*1024*1024?"high":"max";
  if(HIGH_PATH.test(path))return size>4*1024*1024?"standard":"high";
  if(size>4*1024*1024)return "standard";
  if(size<12*1024)return "standard";
  return "high";
}

export function refinedDetailQuality(result={},initial="high"){
  if(!["standard","high","max"].includes(initial))initial="high";
  if(["ui","normal","mask"].includes(result.textureClass))return "standard";
  if(result.textureClass==="sky")return initial==="max"?"high":initial;

  const metrics=result.metrics||{};
  if(metrics.score===undefined)return initial;

  const score=Number(metrics.score);
  const unsafe=
    Number(metrics.cnnAgreement??1)<qualityTargetFor("standard").cnnAgreement||
    Number(metrics.cnnConfidence??metrics.cnnAgreement??1)<qualityTargetFor("standard").cnnConfidence||
    Number(metrics.colorDrift??0)>qualityTargetFor("standard").colorDrift||
    Number(metrics.edgeGain??1)>qualityTargetFor("standard").edgeGain||
    Number(metrics.hallucinationScore??0)>qualityTargetFor("standard").hallucination||
    Number(metrics.cnnRejectedRatio??0)>qualityTargetFor("standard").cnnRejectedRatio||
    Number(metrics.alphaCoverageDiff??0)>qualityTargetFor("standard").alphaCoverageDiff||
    (metrics.ssim!==undefined&&Number(metrics.ssim)<qualityTargetFor("standard").ssim);

  // 90 is the global floor. Anything below it may be retried conservatively,
  // but it is never promoted to a more aggressive reconstruction tier.
  if(unsafe||score<qualityTargetFor("standard").score)return "standard";

  if(initial==="max"&&score<qualityTargetFor("max").score){
    return score>=qualityTargetFor("high").score?"high":"standard";
  }
  if(initial==="high"&&score<qualityTargetFor("high").score)return "standard";

  if(
    initial==="high" &&
    score>=qualityTargetFor("max").score &&
    Number(metrics.cnnAgreement??1)>=.82 &&
    Number(metrics.cnnConfidence??metrics.cnnAgreement??1)>=.72 &&
    Number(metrics.hallucinationScore??0)<=12 &&
    Number(metrics.cnnRejectedRatio??0)<=.18 &&
    Number(metrics.alphaCoverageDiff??0)<=1 &&
    (metrics.ssim===undefined||Number(metrics.ssim)>=.90) &&
    DETAIL_MATERIALS.has(result.material)
  )return "max";

  return initial;
}

export function qualityLabel(value){
  return value==="max"?"Max":value==="high"?"High":"Current";
}
