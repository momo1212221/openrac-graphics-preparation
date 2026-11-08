// SPDX-License-Identifier: GPL-3.0-or-later

const finiteScore=(row)=>Number.isFinite(Number(row?.metrics?.score))?Number(row.metrics.score):null;
const rate=(count,total)=>total?Number((count/total*100).toFixed(2)):0;
const percentile=(sorted,p)=>{
  if(!sorted.length)return null;
  const index=(sorted.length-1)*p;
  const lo=Math.floor(index),hi=Math.ceil(index),mix=index-lo;
  const value=sorted[lo]*(1-mix)+sorted[hi]*mix;
  return Number(value.toFixed(2));
};

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
  specializedCnnUsed:row.specializedCnnUsed===true,
  specializedRejected:row.specializedRejected===true,
  specializedModelSha:row.specializedModelSha||null,
  alphaEdges:row.alphaEdges||null,
  metrics:row.metrics||null,
  failures:Array.isArray(row.failures?.issues)?row.failures.issues:[],
});

export function buildQualityReport(rows,{limit=20,materialMaps=[]}={}){
  const normalized=(rows||[]).map(compact);
  const scored=normalized.filter((row)=>finiteScore(row)!==null);
  const worst=[...scored].sort((a,b)=>finiteScore(a)-finiteScore(b)||String(a.path).localeCompare(String(b.path))).slice(0,limit);
  const best=[...scored].sort((a,b)=>finiteScore(b)-finiteScore(a)||String(a.path).localeCompare(String(b.path))).slice(0,limit);
  const failures=normalized.filter((row)=>row.failures.length||row.strategy==="fallback"||row.strategy==="original");
  const average=scored.length?scored.reduce((sum,row)=>sum+finiteScore(row),0)/scored.length:null;
  const scores=scored.map(finiteScore).sort((a,b)=>a-b);
  const standardCount=scores.filter((score)=>score>=90).length;
  const highCount=scores.filter((score)=>score>=94).length;
  const maxCount=scores.filter((score)=>score>=97).length;
  const materialGroups=new Map();
  for(const row of scored){
    const material=row.material||"unknown";
    if(!materialGroups.has(material))materialGroups.set(material,[]);
    materialGroups.get(material).push(finiteScore(row));
  }
  const materialBreakdown=[...materialGroups.entries()].map(([material,values])=>{
    const sorted=[...values].sort((a,b)=>a-b);
    const standard=sorted.filter((score)=>score>=90).length;
    const high=sorted.filter((score)=>score>=94).length;
    const max=sorted.filter((score)=>score>=97).length;
    return {
      material,
      count:sorted.length,
      average:Number((sorted.reduce((a,b)=>a+b,0)/sorted.length).toFixed(2)),
      belowStandard:sorted.length-standard,
      standardRate:rate(standard,sorted.length),
      highRate:rate(high,sorted.length),
      maxRate:rate(max,sorted.length),
      min:Number(sorted[0].toFixed(2)),
      p50:percentile(sorted,.50),
      p95:percentile(sorted,.95),
      p99:percentile(sorted,.99),
      max:Number(sorted[sorted.length-1].toFixed(2)),
    };
  }).sort((a,b)=>a.standardRate-b.standardRate||a.average-b.average||a.material.localeCompare(b.material));
  return {
    version:2,
    generatedBy:"Graphics preparation 0.16.1",
    evaluated:normalized.length,
    scored:scored.length,
    averageScore:average==null?null:Number(average.toFixed(2)),
    belowStandardCount:scores.length-standardCount,
    tiers:{
      standard:{threshold:90,count:standardCount,rate:rate(standardCount,scores.length)},
      high:{threshold:94,count:highCount,rate:rate(highCount,scores.length)},
      max:{threshold:97,count:maxCount,rate:rate(maxCount,scores.length)},
    },
    percentiles:{
      min:scores.length?Number(scores[0].toFixed(2)):null,
      p50:percentile(scores,.50),
      p90:percentile(scores,.90),
      p95:percentile(scores,.95),
      p99:percentile(scores,.99),
      max:scores.length?Number(scores[scores.length-1].toFixed(2)):null,
    },
    failureCount:failures.length,
    materialBreakdown,
    worst,
    best,
    failures,
    materialMaps:(materialMaps||[]).map((row)=>({
      hash:row.hash,
      path:row.path,
      material:row.material||null,
      ok:row.quality?.ok!==false,
      issues:row.quality?.issues||[],
      meanNormalLengthError:row.quality?.meanNormalLengthError??null,
      backwardNormalPercent:row.quality?.backwardNormalPercent??null,
      normalTilt:row.quality?.normalTilt||null,
      heightRelief:row.quality?.heightRelief||null,
      reliefWarnings:row.quality?.reliefWarnings||[],
      worstSeam:row.quality?.worstSeam??null,
      scalarStats:row.quality?.scalarStats||{},
      pbrValidation:row.pbrValidation||row.quality?.pbrValidation||null,
      pbrCalibration:row.pbrCalibration||row.quality?.pbrCalibration||null,
      albedoValidation:row.albedoValidation||row.quality?.albedoValidation||null,
      albedoDelight:row.albedoDelight||row.quality?.albedoDelight||null,
      heightPipeline:row.heightPipeline||row.quality?.heightPipeline||null,
      seamScores:row.quality?.seamScores||{},
    })),
  };
}
