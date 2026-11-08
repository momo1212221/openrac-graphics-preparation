// SPDX-License-Identifier: GPL-3.0-or-later
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function edgeMismatch(map){
  const {width:w,height:h,data}=map;
  if(w<2||h<2)return 0;
  let sum=0,n=0;
  for(let y=0;y<h;y++){
    const a=(y*w)*4,b=(y*w+w-1)*4;
    for(let c=0;c<3;c++){sum+=Math.abs(data[a+c]-data[b+c]);n++}
  }
  for(let x=0;x<w;x++){
    const a=x*4,b=((h-1)*w+x)*4;
    for(let c=0;c<3;c++){sum+=Math.abs(data[a+c]-data[b+c]);n++}
  }
  return n?sum/n:0;
}

function validateHeightPipeline(maps){
  const pipeline=maps?.heightPipeline;
  const issues=[];
  if(!pipeline)return {ok:false,issues:["missing-height-pipeline"],version:null};

  if(pipeline.version!==2)issues.push("height-pipeline-version");
  const expected=[
    "upscaled-diffuse","albedo-cleanup","coarse-height","mid-height","micro-height",
    "height-merge","normal-from-height","ao-roughness",
    ...(pipeline.curvatureEnabled?["curvature"]:[])
  ];
  if(!Array.isArray(pipeline.order)||pipeline.order.length!==expected.length||
     pipeline.order.some((stage,i)=>stage!==expected[i]))issues.push("height-pipeline-order");

  for(const band of ["coarse","mid","micro"]){
    const row=pipeline.bands?.[band];
    if(!row||![row.meanAbs,row.min,row.max].every(Number.isFinite))issues.push("height-"+band+"-stats");
  }

  const merged=pipeline.merged;
  if(!merged||![merged.meanHeight,merged.reliefRange].every(Number.isFinite)){
    issues.push("height-merge-stats");
  }else{
    if(merged.meanHeight<.35||merged.meanHeight>.65)issues.push("height-mean-bias");
    if(merged.reliefRange<0||merged.reliefRange>.90)issues.push("height-relief-range");
  }

  const surface=pipeline.surface;
  if(!surface||![surface.meanAo,surface.meanRoughness].every(Number.isFinite)){
    issues.push("height-surface-stats");
  }else{
    if(surface.meanAo<.33||surface.meanAo>1.001)issues.push("height-ao-range");
    if(surface.meanRoughness<.035||surface.meanRoughness>.985)issues.push("height-roughness-range");
  }

  if(Boolean(maps?.curvature)!==Boolean(pipeline.curvatureEnabled))issues.push("curvature-stage-mismatch");
  if(pipeline.curvatureEnabled&&surface?.meanCurvature!==null&&!Number.isFinite(surface?.meanCurvature))
    issues.push("curvature-stats");
  if(!Number.isFinite(pipeline.emissiveProtectionPixels)||pipeline.emissiveProtectionPixels<0)
    issues.push("emissive-protection-stats");

  return {ok:issues.length===0,issues,version:pipeline.version,expectedOrder:expected};
}

export function validateMaterialMaps(maps){
  const issues=[];
  const pbrValidation=maps?.pbrValidation||null;
  const albedoValidation=maps?.albedoValidation||null;
  const heightPipelineValidation=validateHeightPipeline(maps);
  if(pbrValidation?.ok===false){
    for(const issue of pbrValidation.issues||[])issues.push("pbr-"+issue);
  }
  if(albedoValidation?.ok===false){
    for(const issue of albedoValidation.issues||[])issues.push("albedo-"+issue);
  }
  if(heightPipelineValidation.ok===false){
    for(const issue of heightPipelineValidation.issues)issues.push(issue);
  }
  let normalError=0,normalCount=0,normalBackward=0,normalTiltSum=0,normalFlat=0,normalSteep=0;
  const normalTilts=[];
  const normal=maps?.normal;
  if(normal){
    for(let i=0;i<normal.data.length;i+=4){
      if(normal.data[i+3]<16)continue;
      const nx=normal.data[i]/127.5-1,ny=normal.data[i+1]/127.5-1,nz=normal.data[i+2]/127.5-1;
      const length=Math.hypot(nx,ny,nz);
      normalError+=Math.abs(length-1);normalCount++;
      if(nz<-.02)normalBackward++;
      const cosine=length?clamp(nz/length,-1,1):1;
      const tilt=Math.acos(cosine)*180/Math.PI;
      normalTiltSum+=tilt;
      normalTilts.push(tilt);
      if(tilt<2)normalFlat++;
      if(tilt>70)normalSteep++;
    }
  }
  normalTilts.sort((a,b)=>a-b);
  const tiltPercentile=(p)=>{
    if(!normalTilts.length)return 0;
    const at=(normalTilts.length-1)*p,lo=Math.floor(at),hi=Math.ceil(at),mix=at-lo;
    return normalTilts[lo]*(1-mix)+normalTilts[hi]*mix;
  };
  const meanNormalLengthError=normalCount?normalError/normalCount:0;
  const backwardNormalPercent=normalCount?normalBackward/normalCount*100:0;
  const normalTilt={
    meanDeg:Number((normalCount?normalTiltSum/normalCount:0).toFixed(3)),
    p50Deg:Number(tiltPercentile(.5).toFixed(3)),
    p95Deg:Number(tiltPercentile(.95).toFixed(3)),
    maxDeg:Number((normalTilts.at(-1)||0).toFixed(3)),
    flatPercent:Number((normalCount?normalFlat/normalCount*100:0).toFixed(2)),
    steepPercent:Number((normalCount?normalSteep/normalCount*100:0).toFixed(2)),
  };
  if(meanNormalLengthError>.04)issues.push("normal-length");
  if(backwardNormalPercent>.1)issues.push("normal-facing");

  const scalarStats={};
  for(const name of ["roughness","metallic","ao","height","specular","cavity","curvature","edgewear"]){
    const map=maps?.[name];if(!map)continue;
    let lo=255,hi=0,sum=0,n=0;
    for(let i=0;i<map.data.length;i+=4){
      if(map.data[i+3]<16)continue;
      const v=map.data[i];lo=Math.min(lo,v);hi=Math.max(hi,v);sum+=v;n++;
      if(Math.abs(map.data[i]-map.data[i+1])>1||Math.abs(map.data[i]-map.data[i+2])>1){
        issues.push(name+"-not-scalar");break;
      }
    }
    scalarStats[name]={min:n?lo/255:null,max:n?hi/255:null,mean:n?sum/n/255:null};
  }
  if(scalarStats.roughness?.min!==null&&scalarStats.roughness.min<.035)issues.push("roughness-too-low");
  if(scalarStats.roughness?.max!==null&&scalarStats.roughness.max>.985)issues.push("roughness-too-high");

  const heightRelief=scalarStats.height?.min==null?null:{
    min:Number(scalarStats.height.min.toFixed(4)),
    max:Number(scalarStats.height.max.toFixed(4)),
    mean:Number(scalarStats.height.mean.toFixed(4)),
    range:Number((scalarStats.height.max-scalarStats.height.min).toFixed(4)),
  };
  const reliefWarnings=[];
  if(normalTilt.steepPercent>8)reliefWarnings.push("normal-steep-tail");
  if(heightRelief?.range>.84)reliefWarnings.push("height-near-clamp");
  if((maps?.heightPipeline?.merged?.reliefRange??0)>.84)reliefWarnings.push("merged-height-near-clamp");

  const seams={};
  for(const name of ["albedo","normal","roughness","height","ao","emissive","specular","metallic","cavity","curvature","edgewear"]){
    if(maps?.[name])seams[name]=Number(edgeMismatch(maps[name]).toFixed(2));
  }
  return {
    ok:issues.length===0,
    issues:[...new Set(issues)],
    meanNormalLengthError:Number(meanNormalLengthError.toFixed(5)),
    backwardNormalPercent:Number(backwardNormalPercent.toFixed(3)),
    normalTilt,
    heightRelief,
    reliefWarnings:[...new Set(reliefWarnings)],
    scalarStats,
    pbrValidation,
    pbrCalibration:maps?.pbrCalibration||null,
    albedoValidation,
    albedoDelight:maps?.albedoDelight||null,
    heightPipeline:maps?.heightPipeline||null,
    heightPipelineValidation,
    seamScores:seams,
    worstSeam:Number(Math.max(0,...Object.values(seams)).toFixed(2)),
  };
}
