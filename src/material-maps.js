// SPDX-License-Identifier: GPL-3.0-or-later
const clamp8=(v)=>Math.max(0,Math.min(255,Math.round(v)));
const luma=(r,g,b)=>(54*r+183*g+19*b)/256;
const idx=(w,x,y)=>(y*w+x)*4;

const ROUGHNESS=Object.freeze({
  generic:.58,terrain:.76,stone:.72,metal:.28,fabric:.82,organic:.62,character:.52,
  weapon:.34,energy:.22,glass:.10,sky:.72,ui:.55,normal:.5,mask:.5,
});
const NORMAL_STRENGTH=Object.freeze({
  generic:1.0,terrain:1.2,stone:1.35,metal:.8,fabric:1.05,organic:.85,character:.65,
  weapon:.85,energy:.35,glass:.15,sky:.2,
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

export function deriveMaterialMaps(image,material="generic"){
  const {width:w,height:h,data}=image;
  const lum=luminanceField(image);
  const height=rgba(w,h),normal=rgba(w,h,[128,128,255,255]),roughness=rgba(w,h),ao=rgba(w,h),emissive=rgba(w,h,[0,0,0,255]);
  const baseR=ROUGHNESS[material]??ROUGHNESS.generic;
  const normalStrength=NORMAL_STRENGTH[material]??1;
  let emissivePixels=0;

  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x,i=p*4;
    const sourceAlpha=data[i+3];
    const center=lum[p];
    const mean=localMean(lum,w,h,x,y,2);
    // Height remains mostly source luminance, with a restrained local-structure term.
    const hv=Math.max(0,Math.min(1,center+(center-mean)*.22));
    const h8=clamp8(hv*255);
    height.data[i]=height.data[i+1]=height.data[i+2]=h8;height.data[i+3]=sourceAlpha;

    const dx=(fieldAt(lum,w,h,x+1,y)-fieldAt(lum,w,h,x-1,y))*normalStrength;
    const dy=(fieldAt(lum,w,h,x,y+1)-fieldAt(lum,w,h,x,y-1))*normalStrength;
    let nx=-dx,ny=-dy,nz=1;
    const length=Math.hypot(nx,ny,nz)||1;nx/=length;ny/=length;nz/=length;
    normal.data[i]=clamp8((nx*.5+.5)*255);
    normal.data[i+1]=clamp8((ny*.5+.5)*255);
    normal.data[i+2]=clamp8((nz*.5+.5)*255);
    normal.data[i+3]=sourceAlpha;

    const localDetail=Math.min(1,Math.abs(center-mean)*4);
    const rv=Math.max(.04,Math.min(.98,baseR+localDetail*(material==="metal"||material==="glass"?.08:.14)));
    const r8=clamp8(rv*255);
    roughness.data[i]=roughness.data[i+1]=roughness.data[i+2]=r8;roughness.data[i+3]=sourceAlpha;

    // Dark local valleys occlude more; broad brightness is not mistaken for AO.
    const cavity=Math.max(0,mean-center);
    const av=Math.max(.35,1-cavity*1.7);
    const a8=clamp8(av*255);
    ao.data[i]=ao.data[i+1]=ao.data[i+2]=a8;ao.data[i+3]=sourceAlpha;

    const r=data[i],g=data[i+1],b=data[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    const sat=mx?((mx-mn)/mx):0;
    const threshold=material==="energy"?.48:material==="weapon"?.78:.86;
    const e=Math.max(0,(center-threshold)/(1-threshold))*Math.max(.15,sat);
    if(e>.02){
      emissive.data[i]=clamp8(r*e);emissive.data[i+1]=clamp8(g*e);emissive.data[i+2]=clamp8(b*e);
      emissivePixels++;
    }
    emissive.data[i+3]=sourceAlpha;
  }

  return {height,normal,roughness,ao,emissive,emissivePixels};
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
    const out={emissivePixels:maps.emissivePixels};
    for(const name of ["normal","roughness","height","ao","emissive"])out[name]=await encode(maps[name]);
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
