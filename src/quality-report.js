// SPDX-License-Identifier: GPL-3.0-or-later

const finiteScore=(row)=>Number.isFinite(Number(row?.metrics?.score))?Number(row.metrics.score):null;

const compact=(row)=>({
  hash:row.hash,
  path:row.path,
  strategy:row.strategy,
  textureClass:row.textureClass||null,
  material:row.material||null,
  detailQuality:row.detailQuality||null,
  backend:row.backend||null,
  masterScale:Number(row.masterScale)||4,
  cached:row.cached===true,
  metrics:row.metrics||null,
  failures:Array.isArray(row.failures?.issues)?row.failures.issues:[],
});

export function buildQualityReport(rows,{limit=20}={}){
  const normalized=(rows||[]).map(compact);
  const scored=normalized.filter((row)=>finiteScore(row)!==null);
  const worst=[...scored].sort((a,b)=>finiteScore(a)-finiteScore(b)||String(a.path).localeCompare(String(b.path))).slice(0,limit);
  const best=[...scored].sort((a,b)=>finiteScore(b)-finiteScore(a)||String(a.path).localeCompare(String(b.path))).slice(0,limit);
  const failures=normalized.filter((row)=>row.failures.length||row.strategy==="fallback"||row.strategy==="original");
  const average=scored.length?scored.reduce((sum,row)=>sum+finiteScore(row),0)/scored.length:null;
  return {
    version:1,
    generatedBy:"Graphics preparation 0.11.0",
    evaluated:normalized.length,
    scored:scored.length,
    averageScore:average==null?null:Number(average.toFixed(2)),
    failureCount:failures.length,
    worst,
    best,
    failures,
  };
}
