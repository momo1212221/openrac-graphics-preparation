// SPDX-License-Identifier: GPL-3.0-or-later
const VERSION=1;
export const RUN_PIPELINE="ai-resume-v1";

const clean=(v)=>String(v??"").replace(/[^a-z0-9._-]+/gi,"-").toLowerCase();

export function aiRunStoreKey(packId){
  return `texture-preparation-ai-run-v${VERSION}:${clean(packId||"openrac")}`;
}

export function aiRunSignature(state={}){
  return [
    RUN_PIPELINE,
    state.includeInterface!==false?"ui1":"ui0",
    ["faithful","balanced","enhanced"].includes(state.aiMode)?state.aiMode:"balanced",
    ["auto","standard","high","max"].includes(state.detailQuality)?state.detailQuality:"auto",
    state.detailCnn!==false?"detail1":"detail0",
    state.sourceColorLock!==false?"color1":"color0",
    state.qualityGuard!==false?"guard1":"guard0",
    state.master8x!==false?"master1":"master0",
    state.preserveMicrodetail!==false?"micro1":"micro0",
    state.preserveStars!==false?"stars1":"stars0",
    ["off","key","all"].includes(state.materialMaps)?state.materialMaps:"off",
  ].join("|");
}

const unique=(rows)=>[...new Set((rows??[]).filter(Boolean).map((v)=>String(v).toLowerCase()))];

export function beginAiRun(previous,{packId,signature,hashes}){
  const same=previous&&previous.version===VERSION&&previous.packId===packId&&previous.signature===signature;
  const completed=same?unique(previous.completedHashes):[];
  return {
    version:VERSION,
    packId,
    signature,
    status:"running",
    hashes:unique(hashes),
    completedHashes:completed,
    startedAt:same&&previous.startedAt?previous.startedAt:Date.now(),
    updatedAt:Date.now(),
    finishedAt:null,
  };
}

export function checkpointAiRun(run,hashes){
  const completed=new Set(unique(run?.completedHashes));
  for(const hash of unique(hashes))completed.add(hash);
  return {...run,status:"running",completedHashes:[...completed],updatedAt:Date.now()};
}

export function interruptAiRun(run){
  if(!run)return run;
  return {...run,status:"interrupted",updatedAt:Date.now()};
}

export function completeAiRun(run){
  if(!run)return run;
  return {...run,status:"complete",completedHashes:unique(run.hashes),updatedAt:Date.now(),finishedAt:Date.now()};
}

export function aiRunProgress(run,{packId,signature,hashes}){
  const current=unique(hashes);
  if(!run||run.version!==VERSION||run.packId!==packId){
    return {compatible:false,status:"none",completed:0,total:current.length,percent:0};
  }
  const compatible=run.signature===signature;
  const completedSet=new Set(unique(run.completedHashes));
  const completed=current.filter((hash)=>completedSet.has(hash)).length;
  const total=current.length;
  return {
    compatible,
    status:run.status||"interrupted",
    completed,
    total,
    percent:total?Math.round(completed/total*100):0,
    updatedAt:Number(run.updatedAt)||0,
  };
}
