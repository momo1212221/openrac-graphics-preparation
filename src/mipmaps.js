// SPDX-License-Identifier: GPL-3.0-or-later
import {alphaProfile} from "./alpha-reconstruct.js";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

async function decode(bytes){
  const blob=new Blob([bytes],{type:"image/png"});
  if(typeof createImageBitmap==="function")return createImageBitmap(blob);
  const url=URL.createObjectURL(blob);
  try{
    const image=new Image();
    image.decoding="async";
    image.src=url;
    await image.decode();
    return image;
  }finally{URL.revokeObjectURL(url)}
}

const pngBytes=(canvas)=>new Promise((resolve,reject)=>{
  canvas.toBlob(async(blob)=>{
    if(!blob)return reject(new Error("could not encode mip PNG"));
    resolve(new Uint8Array(await blob.arrayBuffer()));
  },"image/png");
});

export function mipDimensions(width,height,{maxLevels=8,minSize=1}={}){
  const levels=[];
  let w=Math.max(1,Math.floor(width)),h=Math.max(1,Math.floor(height));
  for(let level=1;level<=maxLevels;level++){
    if(w<=minSize&&h<=minSize)break;
    w=Math.max(minSize,Math.floor(w/2));
    h=Math.max(minSize,Math.floor(h/2));
    levels.push({level,width:w,height:h});
    if(w===minSize&&h===minSize)break;
  }
  return levels;
}

export function alphaCoverage(data,threshold=128){
  let covered=0,total=0;
  for(let i=3;i<data.length;i+=4){
    if(data[i]>=threshold)covered++;
    total++;
  }
  return total?covered/total:0;
}

export function preserveAlphaCoverage(data,targetCoverage,threshold=128){
  const hist=new Uint32Array(256);
  for(let i=3;i<data.length;i+=4)hist[data[i]]++;
  const total=data.length/4;
  const target=Math.round(clamp(targetCoverage,0,1)*total);
  let above=0,chosen=threshold;
  for(let a=255;a>=0;a--){
    above+=hist[a];
    if(above>=target){chosen=a;break;}
  }
  const bias=clamp(threshold-chosen,-64,64);
  if(bias){
    for(let i=3;i<data.length;i+=4)data[i]=clamp(data[i]+bias,0,255);
  }
  return {bias,coverage:alphaCoverage(data,threshold)};
}

export function shouldGenerateMipmaps(textureClass,material,mode="key"){
  if(mode==="off")return false;
  if(textureClass==="normal"||textureClass==="mask"||textureClass==="ui")return false;
  if(mode==="all")return textureClass==="diffuse"||textureClass==="sky";
  return ["weapon","character","terrain","stone","metal","fabric","organic","sky"].includes(material);
}

export async function generateMipChain(bytes,{maxLevels=6,minSize=1,preserveCutoutCoverage=true}={}){
  const image=await decode(bytes);
  try{
    const base=document.createElement("canvas");
    base.width=image.width;base.height=image.height;
    const baseCtx=base.getContext("2d",{alpha:true,willReadFrequently:true});
    if(!baseCtx)throw new Error("2D image processing is unavailable");
    baseCtx.drawImage(image,0,0);
    const baseData=baseCtx.getImageData(0,0,base.width,base.height);
    const profile=alphaProfile(baseData);
    const targetCoverage=profile.coverage128;
    const dims=mipDimensions(base.width,base.height,{maxLevels,minSize});
    const levels=[];
    let previous=base;

    for(const dim of dims){
      const canvas=document.createElement("canvas");
      canvas.width=dim.width;canvas.height=dim.height;
      const ctx=canvas.getContext("2d",{alpha:true,willReadFrequently:true});
      if(!ctx)throw new Error("2D image processing is unavailable");
      ctx.imageSmoothingEnabled=true;
      ctx.imageSmoothingQuality="high";
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(previous,0,0,canvas.width,canvas.height);

      let coverage=null,alphaBias=0;
      if(preserveCutoutCoverage&&profile.hardCutout){
        const data=ctx.getImageData(0,0,canvas.width,canvas.height);
        const fixed=preserveAlphaCoverage(data.data,targetCoverage,128);
        alphaBias=fixed.bias;coverage=fixed.coverage;
        ctx.putImageData(data,0,0);
      }else if(profile.hasTransparency){
        const data=ctx.getImageData(0,0,canvas.width,canvas.height);
        coverage=alphaCoverage(data.data,128);
      }

      levels.push({
        level:dim.level,width:dim.width,height:dim.height,
        bytes:await pngBytes(canvas),
        alphaCoverage:coverage==null?null:Number(coverage.toFixed(4)),
        alphaBias,
      });
      previous=canvas;
    }

    return {
      sourceWidth:base.width,
      sourceHeight:base.height,
      hardCutout:profile.hardCutout,
      targetAlphaCoverage:profile.hasTransparency?Number(targetCoverage.toFixed(4)):null,
      levels,
    };
  }finally{if(typeof image.close==="function")image.close();}
}
