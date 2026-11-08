import {validateMaterialMaps} from "./material-map-quality.js";
import {calibratePbrMaps,validatePbrCalibration} from "./pbr-calibration.js";
import {deriveAlbedoSidecar,validateAlbedoSidecar} from "./albedo-delight.js";
import {deriveMultiScaleHeight} from "./material-height.js";
// SPDX-License-Identifier: GPL-3.0-or-later
const clamp8=(v)=>Math.max(0,Math.min(255,Math.round(v)));
const luma=(r,g,b)=>(54*r+183*g+19*b)/256;
const idx=(w,x,y)=>(y*w+x)*4;

const ROUGHNESS=Object.freeze({
  generic:.58,terrain:.76,stone:.72,metal:.28,fabric:.82,organic:.62,character:.52,
  weapon:.34,energy:.22,glass:.10,sky:.72,ui:.55,normal:.5,mask:.5,
});

function rgba(width,height,fill=[0,0,0,255]){
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<data.length;i+=4)data.set(fill,i);
  return {width,height,data};
}

function luminanceField(image){
  const out=new Float32Array(image.width*image.height);
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const i=idx(image.width,x,y);
    out[y*image.width+x]=luma(image.data[i],image.data[i+1],image.data[i+2])/255;
  }
  return out;
}
function fieldAt(field,w,h,x,y){
  x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));
  return field[y*w+x];
}
function localMean(field,w,h,x,y,r=2){
  let sum=0,n=0;
  for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r);yy++)
    for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx++){sum+=field[yy*w+xx];n++}
  return n?sum/n:field[y*w+x];
}

function deriveEmissive(image,material){
  const {width:w,height:h,data}=image;
  const lum=luminanceField(image);
  const emissive=rgba(w,h,[0,0,0,255]);
  let emissivePixels=0;
  for(let p=0;p<w*h;p++){
    const i=p*4;
    const sourceAlpha=data[i+3];
    if(sourceAlpha<16){emissive.data[i+3]=sourceAlpha;continue}
    const center=lum[p];
    const r=data[i],g=data[i+1],b=data[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    const sat=mx?((mx-mn)/mx):0;
    const threshold=material==="energy"?.48:material==="weapon"?.78:.86;
    const peak=mx/255;
    const brightness=material==="energy"
      ? Math.max(center,peak*.72)
      : material==="weapon" ? Math.max(center,peak*.28+center*.72) : center;
    const e=Math.max(0,(brightness-threshold)/(1-threshold))*Math.max(.15,sat);
    if(e>.02){
      emissive.data[i]=clamp8(r*e);
      emissive.data[i+1]=clamp8(g*e);
      emissive.data[i+2]=clamp8(b*e);
      emissivePixels++;
    }
    emissive.data[i+3]=sourceAlpha;
  }
  return {emissive,emissivePixels};
}

/**
 * Material pipeline:
 * source colour -> emissive detection -> conservative de-lighted albedo
 * -> multi-scale relative height -> tangent normal / AO / cavity / curvature / PBR sidecars.
 * The original colour texture is never replaced by these derived maps.
 */
export function deriveMaterialMaps(image,material="generic"){
  const {width:w,height:h,data}=image;

  // Emission must be detected from the original reconstructed colour before de-lighting.
  const {emissive,emissivePixels}=deriveEmissive(image,material);
  const albedoResult=deriveAlbedoSidecar(image,emissive,material);
  const albedoValidation=validateAlbedoSidecar(albedoResult);
  const albedo=albedoResult.image;

  // Geometry-like sidecars are intentionally derived from de-lit albedo rather than raw colour.
  const heightReconstruction=deriveMultiScaleHeight(albedo,material);
  const heightField=heightReconstruction.heightField;
  const normal=heightReconstruction.normal;
  const albedoLum=luminanceField(albedo);

  const height=rgba(w,h),roughness=rgba(w,h),ao=rgba(w,h),specular=rgba(w,h),
    metallic=rgba(w,h),cavityMap=rgba(w,h),curvature=rgba(w,h),edgewear=rgba(w,h);
  const baseR=ROUGHNESS[material]??ROUGHNESS.generic;

  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x,i=p*4;
    const sourceAlpha=data[i+3];
    const hv=heightField[p];
    const h8=clamp8(hv*255);
    height.data[i]=height.data[i+1]=height.data[i+2]=h8;height.data[i+3]=sourceAlpha;

    const albedoCenter=albedoLum[p];
    const albedoMean=localMean(albedoLum,w,h,x,y,2);
    const heightMean=localMean(heightField,w,h,x,y,2);
    const localDetail=Math.min(1,Math.abs(hv-heightMean)*7+Math.abs(albedoCenter-albedoMean)*1.5);

    const rv=Math.max(.04,Math.min(.98,baseR+localDetail*(material==="metal"||material==="glass"?.07:.13)));
    const r8=clamp8(rv*255);
    roughness.data[i]=roughness.data[i+1]=roughness.data[i+2]=r8;roughness.data[i+3]=sourceAlpha;

    // AO and cavity now come from relative reconstructed geometry instead of absolute darkness.
    const cavity=Math.max(0,heightMean-hv);
    const av=Math.max(.38,1-cavity*2.2);
    const a8=clamp8(av*255);
    ao.data[i]=ao.data[i+1]=ao.data[i+2]=a8;ao.data[i+3]=sourceAlpha;

    const cavityValue=clamp8(Math.min(1,cavity*5.0)*255);
    cavityMap.data[i]=cavityMap.data[i+1]=cavityMap.data[i+2]=cavityValue;cavityMap.data[i+3]=sourceAlpha;

    const lap=Math.abs(
      fieldAt(heightField,w,h,x-1,y)+fieldAt(heightField,w,h,x+1,y)+
      fieldAt(heightField,w,h,x,y-1)+fieldAt(heightField,w,h,x,y+1)-hv*4
    );
    const curvatureValue=clamp8(Math.min(1,lap*4.2)*255);
    curvature.data[i]=curvature.data[i+1]=curvature.data[i+2]=curvatureValue;curvature.data[i+3]=sourceAlpha;

    const metalPrior=material==="metal"?.92:material==="weapon"?.62:material==="energy"?.18:.04;
    const metallicValue=clamp8(metalPrior*255);
    metallic.data[i]=metallic.data[i+1]=metallic.data[i+2]=metallicValue;metallic.data[i+3]=sourceAlpha;

    const specPrior=material==="glass"?.92:material==="metal"?.78:material==="weapon"?.66:material==="energy"?.72:.28;
    const specValue=clamp8(Math.min(1,specPrior+localDetail*.12)*255);
    specular.data[i]=specular.data[i+1]=specular.data[i+2]=specValue;specular.data[i+3]=sourceAlpha;

    const edgeValue=clamp8(Math.min(1,lap*2.8+Math.max(0,hv-heightMean)*1.6)*255);
    edgewear.data[i]=edgewear.data[i+1]=edgewear.data[i+2]=edgeValue;edgewear.data[i+3]=sourceAlpha;
  }

  const maps={
    albedo,height,normal,roughness,ao,emissive,specular,metallic,
    cavity:cavityMap,curvature,edgewear,
  };
  const pbrCalibration=calibratePbrMaps(maps,albedo,material);
  const pbrValidation=validatePbrCalibration(pbrCalibration);
  const heightMetadata={
    profile:heightReconstruction.profile,
    stats:heightReconstruction.stats,
    source:"de-lit-albedo",
    bands:["coarse","mid","micro"],
  };
  return {
    ...maps,
    emissivePixels,
    pbrCalibration,
    pbrValidation,
    heightReconstruction:heightMetadata,
    albedoDelight:{...albedoResult,image:undefined},
    albedoValidation,
  };
}

const imageFromBytes=async(bytes)=>{
  const blob=new Blob([bytes],{type:"image/png"});
  if(typeof createImageBitmap==="function")return createImageBitmap(blob);
  const url=URL.createObjectURL(blob);
  try{const image=new Image();image.src=url;await image.decode();return image;}finally{URL.revokeObjectURL(url)}
};
const encode=async(map)=>{
  const canvas=document.createElement("canvas");canvas.width=map.width;canvas.height=map.height;
  const ctx=canvas.getContext("2d");ctx.putImageData(new ImageData(map.data,map.width,map.height),0,0);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(new Error("material map PNG encode failed")),"image/png"));
  return new Uint8Array(await blob.arrayBuffer());
};

export async function generateMaterialMapPngs(bytes,material="generic"){
  const image=await imageFromBytes(bytes);
  try{
    const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext("2d",{alpha:true,willReadFrequently:true});ctx.drawImage(image,0,0);
    const source=ctx.getImageData(0,0,canvas.width,canvas.height);
    const maps=deriveMaterialMaps(source,material);
    const out={
      emissivePixels:maps.emissivePixels,
      pbrCalibration:maps.pbrCalibration,pbrValidation:maps.pbrValidation,
      heightReconstruction:maps.heightReconstruction,
      albedoDelight:maps.albedoDelight,albedoValidation:maps.albedoValidation,
      quality:validateMaterialMaps(maps),
    };
    for(const name of ["albedo","normal","roughness","height","ao","emissive","specular","metallic","cavity","curvature","edgewear"])
      out[name]=await encode(maps[name]);
    return out;
  }finally{if(typeof image.close==="function")image.close()}
}

export function shouldGenerateMaterialMaps(textureClass,material,mode="key"){
  if(mode==="off")return false;
  if(!["diffuse"].includes(textureClass))return false;
  if(["ui","normal","mask","sky","glass"].includes(material))return false;
  if(mode==="all")return true;
  return ["weapon","character","terrain","stone","metal","fabric","organic","energy"].includes(material);
}
