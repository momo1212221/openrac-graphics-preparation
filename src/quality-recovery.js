// SPDX-License-Identifier: GPL-3.0-or-later
import {highestPassingQuality} from "./quality-policy.js";

const LOW_RISK=new Set(["stone","metal","terrain","fabric","weapon","generic"]);
const HIGH_RISK=new Set(["glass","energy","sky"]);
const MID_RISK=new Set(["character","organic"]);

const profileKey=(p)=>[
  p.mode,p.detailQuality,p.detailCnn,p.sourceColorLock,p.master8x,p.preserveMicrodetail,p.preserveStars
].join("|");

function pushUnique(out,profile){
  const key=profileKey(profile);
  if(!out.some((row)=>profileKey(row)===key))out.push(profile);
}

export function qualityRecoveryProfiles(result={},state={}){
  const material=String(result.material||"generic");
  const metrics=result.metrics||{};
  const profiles=[];
  const base={
    detailQuality:"standard",
    detailCnn:false,
    sourceColorLock:true,
    master8x:false,
    preserveStars:state.preserveStars!==false,
  };

  const confidence=Number(metrics.cnnConfidence??metrics.cnnAgreement??1);
  const rejection=Number(metrics.cnnRejectedRatio??0);
  const hallucination=Number(metrics.hallucinationScore??0);
  const structuralRisk=confidence<.55||rejection>.3||hallucination>24;

  if(HIGH_RISK.has(material)){
    pushUnique(profiles,{...base,mode:"faithful",preserveMicrodetail:false});
    pushUnique(profiles,{...base,mode:"balanced",preserveMicrodetail:false});
  }else if(MID_RISK.has(material)||structuralRisk){
    pushUnique(profiles,{...base,mode:"faithful",preserveMicrodetail:true});
    pushUnique(profiles,{...base,mode:"faithful",preserveMicrodetail:false});
  }else if(LOW_RISK.has(material)){
    pushUnique(profiles,{...base,mode:"balanced",preserveMicrodetail:true});
    pushUnique(profiles,{...base,mode:"faithful",preserveMicrodetail:true});
  }else{
    pushUnique(profiles,{...base,mode:"faithful",preserveMicrodetail:true});
    pushUnique(profiles,{...base,mode:"balanced",preserveMicrodetail:true});
  }

  return profiles.slice(0,2);
}

export function qualifiedTier(result={},maxTier=result.detailQuality||"max"){
  if(!result?.metrics)return null;
  return highestPassingQuality(result.metrics,result,maxTier);
}

export function applyQualifiedDowngrade(result={}){
  const current=["standard","high","max"].includes(result.detailQuality)?result.detailQuality:"standard";
  const qualified=qualifiedTier(result,current);
  if(!qualified||qualified===current)return {result,changed:false,from:current,to:current};
  return {
    result:{...result,detailQuality:qualified,qualityDowngradedFrom:current},
    changed:true,from:current,to:qualified,
  };
}
