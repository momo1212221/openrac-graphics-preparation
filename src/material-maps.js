import {validateMaterialMaps} from "./material-map-quality.js";
import {calibratePbrMaps,validatePbrCalibration} from "./pbr-calibration.js";
import {deriveAlbedoSidecar,validateAlbedoSidecar} from "./albedo-delight.js";
import {deriveHeightBands,mergeHeightBands,normalFromHeight,deriveHeightSurfaceMaps} from "./material-height.js";
// SPDX-License-Identifier: GPL-3.0-or-later
export const MATERIAL_PIPELINE_VERSION=2;
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

function heightAtVisible(field,source,w,h,x,y,fallback){
  const xx=Math.max(0,Math.min(w-1,x)),yy=Math.max(0,Math.min(h-1,y));
  const p=yy*w+xx;
  return source.data[p*4+3]>=16?field[p]:fallback;
}
function localMean(field,w,h,x,y,r=2){
  let sum=0,n=0;
  for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r);yy++)
    for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx++){sum+=field[yy*w+xx];n++}
  return n?sum/n:field[y*w+x];
}

function deriveEmissiveFromSource(image,material){
  const {width:w,height:h,data}=image;
  const sourceLum=luminanceField(image);
  const emissive=rgba(w,h,[0,0,0,255]);
  let emissivePixels=0;
  for(let p=0;p<w*h;p++){
    const i=p*4,alpha=data[i+3];
    emissive.data[i+3]=alpha;
    if(alpha<16)continue;
    const r=data[i],g=data[i+1],b=data[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    const sat=mx?((mx-mn)/mx):0;
    const threshold=material==="energy"?.46:material==="weapon"?.58:.86;
    const peak=mx/255;
    const brightness=material==="energy"
      ? Math.max(sourceLum[p],peak*.78)
      : material==="weapon" ? Math.max(sourceLum[p],peak*.58+sourceLum[p]*.42) : sourceLum[p];
    const saturationFloor=material==="weapon"?.28:material==="energy"?.12:.15;
    const e=Math.max(0,(brightness-threshold)/(1-threshold))*Math.max(saturationFloor,sat);
    if(e>.02){
      emissive.data[i]=clamp8(r*e);
      emissive.data[i+1]=clamp8(g*e);
      emissive.data[i+2]=clamp8(b*e);
      emissivePixels++;
    }
  }
  return {emissive,emissivePixels};
}

export function deriveReliefPreview(maps){
  const albedo=maps?.albedo,normal=maps?.normal,roughness=maps?.roughness,ao=maps?.ao;
  if(!albedo||!normal||!roughness||!ao)return null;
  const {width:w,height:h}=albedo;
  const out=rgba(w,h,[0,0,0,0]);
  const lx=-.48,ly=-.52,lz=.706;
  const hx=lx*.5,hy=ly*.5,hz=(lz+1)*.5;
  const hlen=Math.hypot(hx,hy,hz)||1;
  const nhx=hx/hlen,nhy=hy/hlen,nhz=hz/hlen;
  for(let i=0;i<out.data.length;i+=4){
    const alpha=albedo.data[i+3];
    out.data[i+3]=alpha;
    if(alpha<16)continue;
    let nx=normal.data[i]/127.5-1,ny=normal.data[i+1]/127.5-1,nz=normal.data[i+2]/127.5-1;
    const nlen=Math.hypot(nx,ny,nz)||1;nx/=nlen;ny/=nlen;nz/=nlen;
    const ndotl=Math.max(0,nx*lx+ny*ly+nz*lz);
    const ndoth=Math.max(0,nx*nhx+ny*nhy+nz*nhz);
    const a=ao.data[i]/255;
    const rough=roughness.data[i]/255;
    const spec=(maps.specular?.data?.[i]??64)/255;
    const shininess=4+(1-rough)*72;
    const specular=Math.pow(ndoth,shininess)*spec*.75;
    const lighting=(.30+.86*ndotl)*(.58+.42*a);
    const er=(maps.emissive?.data?.[i]??0)/255;
    const eg=(maps.emissive?.data?.[i+1]??0)/255;
    const eb=(maps.emissive?.data?.[i+2]??0)/255;
    out.data[i]=clamp8(albedo.data[i]*lighting+255*(specular+er*.9));
    out.data[i+1]=clamp8(albedo.data[i+1]*lighting+255*(specular+eg*.9));
    out.data[i+2]=clamp8(albedo.data[i+2]*lighting+255*(specular+eb*.9));
  }
  return out;
}

/**
 * Production material pipeline:
 *   Upscaled Diffuse
 *    -> Albedo Cleanup
 *    -> Coarse Height
 *    -> Mid Height
 *    -> Micro Height
 *    -> Height Merge
 *    -> Normal From Height
 *    -> AO / Roughness / optional Curvature
 *
 * Additional emissive/specular/metallic/cavity/edgewear sidecars are derived after the geometric
 * pipeline so they cannot accidentally become the source of normals.
 */
export function deriveMaterialMaps(image,material="generic",options={}){
  const includeCurvature=options.curvature!==false;
  const {width:w,height:h,data}=image;

  // Detect emission first so de-lighting cannot flatten intentional lamps, plasma or weapon LEDs.
  const {emissive,emissivePixels}=deriveEmissiveFromSource(image,material);

  // Stage 1: remove bounded low-frequency lighting bias before any geometry reconstruction,
  // while protecting the source-derived emissive mask.
  const albedoResult=deriveAlbedoSidecar(image,emissive,material);
  const albedo=albedoResult.image;
  const albedoValidation=validateAlbedoSidecar(albedoResult);

  // Stages 2-4: frequency-separated height reconstruction and merge.
  const bands=deriveHeightBands(albedo,material);
  const merged=mergeHeightBands(albedo,bands,material);

  // Stage 5: normals are generated from merged height only.
  const normal=normalFromHeight(albedo,merged.heightField,material);

  // Stage 6: geometry-aware AO / roughness / optional signed curvature.
  const surface=deriveHeightSurfaceMaps(
    albedo,merged.heightField,material,ROUGHNESS[material]??ROUGHNESS.generic,
    {curvature:includeCurvature}
  );

  const height=merged.height;
  const roughness=surface.roughness;
  const ao=surface.ao;
  const curvature=surface.curvature;

  // Remaining PBR helpers operate after the height pipeline.
  const specular=rgba(w,h);
  const metallic=rgba(w,h);
  const cavityMap=rgba(w,h);
  const edgewear=rgba(w,h);
  const lum=luminanceField(albedo);

  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x,i=p*4;
    const sourceAlpha=data[i+3];
    if(sourceAlpha<16){
      for(const map of [specular,metallic,cavityMap,edgewear]){
        map.data[i+3]=sourceAlpha;
      }
      continue;
    }

    const center=lum[p];
    const mean=localMean(lum,w,h,x,y,2);
    const localDetail=Math.min(1,Math.abs(center-mean)*4);

    // Cavity follows the final height rather than raw diffuse brightness.
    const hCenter=merged.heightField[p];
    const hMean=(
      heightAtVisible(merged.heightField,albedo,w,h,x-1,y,hCenter)+
      heightAtVisible(merged.heightField,albedo,w,h,x+1,y,hCenter)+
      heightAtVisible(merged.heightField,albedo,w,h,x,y-1,hCenter)+
      heightAtVisible(merged.heightField,albedo,w,h,x,y+1,hCenter)
    )*.25;
    const cavity=Math.max(0,hMean-hCenter);
    const cavityValue=clamp8(Math.min(1,cavity*5.0)*255);
    cavityMap.data[i]=cavityMap.data[i+1]=cavityMap.data[i+2]=cavityValue;cavityMap.data[i+3]=sourceAlpha;

    const lap=Math.abs(
      heightAtVisible(merged.heightField,albedo,w,h,x-1,y,hCenter)+
      heightAtVisible(merged.heightField,albedo,w,h,x+1,y,hCenter)+
      heightAtVisible(merged.heightField,albedo,w,h,x,y-1,hCenter)+
      heightAtVisible(merged.heightField,albedo,w,h,x,y+1,hCenter)-hCenter*4
    );

    const metalPrior=material==="metal"?.92:material==="weapon"?.62:material==="energy"?.18:.04;
    const metallicValue=clamp8(metalPrior*255);
    metallic.data[i]=metallic.data[i+1]=metallic.data[i+2]=metallicValue;metallic.data[i+3]=sourceAlpha;

    const specPrior=material==="glass"?.92:material==="metal"?.78:material==="weapon"?.66:material==="energy"?.72:.28;
    const specValue=clamp8(Math.min(1,specPrior+localDetail*.12)*255);
    specular.data[i]=specular.data[i+1]=specular.data[i+2]=specValue;specular.data[i+3]=sourceAlpha;

    const edgeValue=clamp8(Math.min(1,lap*4.2+Math.max(0,hCenter-hMean)*2.0)*255);
    edgewear.data[i]=edgewear.data[i+1]=edgewear.data[i+2]=edgeValue;edgewear.data[i+3]=sourceAlpha;


  }

  const maps={
    albedo,
    height,
    normal,
    roughness,
    ao,
    emissive,
    specular,
    metallic,
    cavity:cavityMap,
    edgewear,
    coarseHeight:bands.coarse,
    midHeight:bands.mid,
    microHeight:bands.micro,
  };
  if(curvature)maps.curvature=curvature;

  const pbrCalibration=calibratePbrMaps(maps,albedo,material);
  const pbrValidation=validatePbrCalibration(pbrCalibration);
  const reliefPreview=deriveReliefPreview(maps);

  return {
    ...maps,
    reliefPreview,
    emissivePixels,
    pbrCalibration,
    pbrValidation,
    albedoDelight:{...albedoResult,image:undefined},
    albedoValidation,
    heightPipeline:{
      version:MATERIAL_PIPELINE_VERSION,
      order:[
        "upscaled-diffuse","albedo-cleanup","coarse-height","mid-height","micro-height",
        "height-merge","normal-from-height","ao-roughness",...(includeCurvature?["curvature"]:[])
      ],
      material,
      profile:bands.profile,
      bands:bands.stats,
      merged:merged.stats,
      surface:surface.stats,
      curvatureEnabled:includeCurvature,
      emissiveProtectionPixels:emissivePixels,
      parallaxAuthoring:{
        ready:(bands.profile.parallaxScale||0)>0 && merged.stats.reliefRange>.001,
        source:"height.png",
        encoding:"relative-height-0.5-neutral",
        neutralHeight:.5,
        recommendedScale:bands.profile.parallaxScale||0,
        rendererSupportRequired:true,
      },
    },
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

export async function generateMaterialMapPngs(bytes,material="generic",options={}){
  const image=await imageFromBytes(bytes);
  try{
    const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext("2d",{alpha:true,willReadFrequently:true});ctx.drawImage(image,0,0);
    const source=ctx.getImageData(0,0,canvas.width,canvas.height);
    const maps=deriveMaterialMaps(source,material,options);
    const out={
      emissivePixels:maps.emissivePixels,
      pbrCalibration:maps.pbrCalibration,pbrValidation:maps.pbrValidation,
      albedoDelight:maps.albedoDelight,albedoValidation:maps.albedoValidation,
      heightPipeline:maps.heightPipeline,
      quality:validateMaterialMaps(maps),
    };
    const names=[
      "albedo","normal","roughness","height","ao","emissive","specular","metallic",
      "cavity","edgewear","coarseHeight","midHeight","microHeight","reliefPreview"
    ];
    if(maps.curvature)names.push("curvature");
    for(const name of names)out[name]=await encode(maps[name]);
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
