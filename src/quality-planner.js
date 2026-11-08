// SPDX-License-Identifier: GPL-3.0-or-later
import {pathTextureScope} from "./texture-classify.js";

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
  const unsafe=
    Number(metrics.cnnAgreement)<.48||
    Number(metrics.colorDrift)>20||
    Number(metrics.edgeGain)>3.1||
    Number(metrics.hallucinationScore)>65||
    Number(metrics.cnnRejectedRatio??0)>.45||
    Number(metrics.alphaCoverageDiff)>6||
    (metrics.ssim!==undefined&&Number(metrics.ssim)<.55);
  if(unsafe)return "standard";
  if(Number(metrics.score)<55)return "standard";
  if(
    initial==="high" &&
    Number(metrics.score)>=82 &&
    Number(metrics.cnnAgreement)>=.78 &&
    Number(metrics.hallucinationScore??0)<=35 &&
    Number(metrics.cnnRejectedRatio??0)<=.18 &&
    Number(metrics.alphaCoverageDiff??0)<=2 &&
    (metrics.ssim===undefined||Number(metrics.ssim)>=.78) &&
    DETAIL_MATERIALS.has(result.material)
  )return "max";
  return initial;
}

export function qualityLabel(value){
  return value==="max"?"Max":value==="high"?"High":"Current";
}
