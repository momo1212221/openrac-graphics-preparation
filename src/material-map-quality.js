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

export function validateMaterialMaps(maps){
  const issues=[];
  const pbrValidation=maps?.pbrValidation||null;
  const albedoValidation=maps?.albedoValidation||null;
  if(pbrValidation?.ok===false){
    for(const issue of pbrValidation.issues||[])issues.push("pbr-"+issue);
  }
  if(albedoValidation?.ok===false){
    for(const issue of albedoValidation.issues||[])issues.push("albedo-"+issue);
  }
  let normalError=0,normalCount=0,normalBackward=0;
  const normal=maps?.normal;
  if(normal){
    for(let i=0;i<normal.data.length;i+=4){
      if(normal.data[i+3]<16)continue;
      const nx=normal.data[i]/127.5-1,ny=normal.data[i+1]/127.5-1,nz=normal.data[i+2]/127.5-1;
      const length=Math.hypot(nx,ny,nz);
      normalError+=Math.abs(length-1);normalCount++;
      if(nz<-.02)normalBackward++;
    }
  }
  const meanNormalLengthError=normalCount?normalError/normalCount:0;
  const backwardNormalPercent=normalCount?normalBackward/normalCount*100:0;
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

  const seams={};
  for(const name of ["albedo","normal","roughness","height","ao","emissive","specular","metallic","cavity","curvature","edgewear"]){
    if(maps?.[name])seams[name]=Number(edgeMismatch(maps[name]).toFixed(2));
  }
  return {
    ok:issues.length===0,
    issues:[...new Set(issues)],
    meanNormalLengthError:Number(meanNormalLengthError.toFixed(5)),
    backwardNormalPercent:Number(backwardNormalPercent.toFixed(3)),
    scalarStats,
    pbrValidation,
    pbrCalibration:maps?.pbrCalibration||null,
    albedoValidation,
    albedoDelight:maps?.albedoDelight||null,
    seamScores:seams,
    worstSeam:Number(Math.max(0,...Object.values(seams)).toFixed(2)),
  };
}
