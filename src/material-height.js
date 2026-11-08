// SPDX-License-Identifier: GPL-3.0-or-later
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const clamp8=(v)=>Math.max(0,Math.min(255,Math.round(v)));
const luma=(r,g,b)=>(54*r+183*g+19*b)/256;

export const MATERIAL_HEIGHT_PROFILES=Object.freeze({
  generic:Object.freeze({coarseRadius:7,midRadius:3,coarse:.28,mid:.62,micro:.72,heightGain:1.55,normalStrength:2.4,aoRadius:5,parallaxScale:.025}),
  terrain:Object.freeze({coarseRadius:12,midRadius:4,coarse:.58,mid:.90,micro:.82,heightGain:1.95,normalStrength:3.8,aoRadius:7,parallaxScale:.05}),
  stone:Object.freeze({coarseRadius:10,midRadius:3,coarse:.52,mid:1.08,micro:1.18,heightGain:2.15,normalStrength:4.8,aoRadius:6,parallaxScale:.06}),
  metal:Object.freeze({coarseRadius:7,midRadius:2,coarse:.12,mid:.82,micro:.38,heightGain:1.65,normalStrength:3.2,aoRadius:4,parallaxScale:.022}),
  fabric:Object.freeze({coarseRadius:5,midRadius:2,coarse:.08,mid:.48,micro:1.32,heightGain:1.80,normalStrength:4.1,aoRadius:3,parallaxScale:.018}),
  organic:Object.freeze({coarseRadius:8,midRadius:3,coarse:.34,mid:.72,micro:.68,heightGain:1.55,normalStrength:2.8,aoRadius:5,parallaxScale:.028}),
  character:Object.freeze({coarseRadius:7,midRadius:3,coarse:.18,mid:.42,micro:.38,heightGain:1.15,normalStrength:1.8,aoRadius:4,parallaxScale:.012}),
  weapon:Object.freeze({coarseRadius:7,midRadius:2,coarse:.16,mid:.92,micro:.52,heightGain:1.85,normalStrength:3.7,aoRadius:4,parallaxScale:.03}),
  energy:Object.freeze({coarseRadius:7,midRadius:3,coarse:.06,mid:.12,micro:.08,heightGain:.55,normalStrength:.65,aoRadius:3,parallaxScale:.005}),
  glass:Object.freeze({coarseRadius:7,midRadius:3,coarse:.03,mid:.08,micro:.04,heightGain:.35,normalStrength:.35,aoRadius:3,parallaxScale:.004}),
  sky:Object.freeze({coarseRadius:12,midRadius:5,coarse:.04,mid:.06,micro:.02,heightGain:.30,normalStrength:.25,aoRadius:5,parallaxScale:0}),
  ui:Object.freeze({coarseRadius:5,midRadius:2,coarse:.02,mid:.05,micro:.03,heightGain:.25,normalStrength:.25,aoRadius:2,parallaxScale:0}),
});

function luminance(image){
  const out=new Float32Array(image.width*image.height);
  const {data}=image;
  for(let p=0;p<out.length;p++){
    const i=p*4;
    out[p]=luma(data[i],data[i+1],data[i+2])/255;
  }
  return out;
}

function visibilityMask(image){
  const out=new Uint8Array(image.width*image.height);
  for(let p=0;p<out.length;p++)out[p]=image.data[p*4+3]>=16?1:0;
  return out;
}

function integral(field,w,h,mask=null){
  const stride=w+1;
  const sum=new Float64Array((w+1)*(h+1));
  const count=new Uint32Array((w+1)*(h+1));
  for(let y=1;y<=h;y++){
    let row=0,rowCount=0;
    for(let x=1;x<=w;x++){
      const p=(y-1)*w+(x-1);
      const visible=!mask||mask[p]!==0;
      if(visible){row+=field[p];rowCount++}
      sum[y*stride+x]=sum[(y-1)*stride+x]+row;
      count[y*stride+x]=count[(y-1)*stride+x]+rowCount;
    }
  }
  return {sum,count,stride};
}

function meanAt(ii,w,h,x,y,radius,fallback=.5){
  const x0=Math.max(0,x-radius),y0=Math.max(0,y-radius);
  const x1=Math.min(w-1,x+radius),y1=Math.min(h-1,y+radius);
  const s=ii.stride;
  const ax=x0,ay=y0,bx=x1+1,by=y1+1;
  const sample=(field)=>field[by*s+bx]-field[ay*s+bx]-field[by*s+ax]+field[ay*s+ax];
  const n=sample(ii.count);
  return n?sample(ii.sum)/n:fallback;
}

function fieldAt(field,w,h,x,y){
  const xx=Math.max(0,Math.min(w-1,x));
  const yy=Math.max(0,Math.min(h-1,y));
  return field[yy*w+xx];
}

function fieldAtVisible(field,mask,w,h,x,y,fallback){
  const xx=Math.max(0,Math.min(w-1,x));
  const yy=Math.max(0,Math.min(h-1,y));
  const p=yy*w+xx;
  return !mask||mask[p]?field[p]:fallback;
}

function scalarMap(field,source,mode="absolute",gain=1){
  const {width:w,height:h,data}=source;
  const out=new Uint8ClampedArray(w*h*4);
  for(let p=0;p<w*h;p++){
    const i=p*4,alpha=data[i+3];
    let value=.5;
    if(alpha>=16){
      const raw=field[p]*gain;
      value=mode==="signed"?clamp(.5+raw,.02,.98):clamp(raw,0,1);
    }
    const v=clamp8(value*255);
    out[i]=out[i+1]=out[i+2]=v;out[i+3]=alpha;
  }
  return {width:w,height:h,data:out};
}

function statsFor(field,source){
  let abs=0,min=Infinity,max=-Infinity,sum=0,n=0;
  for(let p=0;p<field.length;p++){
    if(source.data[p*4+3]<16)continue;
    const v=field[p];abs+=Math.abs(v);min=Math.min(min,v);max=Math.max(max,v);sum+=v;n++;
  }
  return {
    visiblePixels:n,
    mean:n?Number((sum/n).toFixed(6)):0,
    meanAbs:n?Number((abs/n).toFixed(6)):0,
    min:n?Number(min.toFixed(6)):0,
    max:n?Number(max.toFixed(6)):0,
  };
}

/**
 * Stage 1-3 after albedo cleanup:
 * Coarse Height, Mid Height and Micro Height are separated into non-overlapping frequency bands.
 * Each band stays signed around zero so colour/lightness is not mistaken for absolute geometry.
 */
export function deriveHeightBands(albedo,material="generic"){
  const {width:w,height:h,data}=albedo;
  const profile=MATERIAL_HEIGHT_PROFILES[material]||MATERIAL_HEIGHT_PROFILES.generic;
  const lum=luminance(albedo);
  const mask=visibilityMask(albedo);
  const ii=integral(lum,w,h,mask);
  const coarseField=new Float32Array(w*h);
  const midField=new Float32Array(w*h);
  const microField=new Float32Array(w*h);

  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x,i=p*4;
    if(data[i+3]<16)continue;
    const center=lum[p];
    const local=meanAt(ii,w,h,x,y,1,center);
    const midMean=meanAt(ii,w,h,x,y,profile.midRadius,local);
    const coarseMean=meanAt(ii,w,h,x,y,profile.coarseRadius,midMean);
    microField[p]=center-local;
    midField[p]=local-midMean;
    coarseField[p]=midMean-coarseMean;
  }

  return {
    coarseField,midField,microField,profile:{...profile},
    coarse:scalarMap(coarseField,albedo,"signed",profile.coarse*profile.heightGain),
    mid:scalarMap(midField,albedo,"signed",profile.mid*profile.heightGain),
    micro:scalarMap(microField,albedo,"signed",profile.micro*profile.heightGain),
    stats:{
      coarse:statsFor(coarseField,albedo),
      mid:statsFor(midField,albedo),
      micro:statsFor(microField,albedo),
    },
  };
}

/** Stage 4: merge the three frequency bands into one bounded relative height field. */
export function mergeHeightBands(albedo,bands,material="generic"){
  const {width:w,height:h,data}=albedo;
  const profile=MATERIAL_HEIGHT_PROFILES[material]||MATERIAL_HEIGHT_PROFILES.generic;
  const heightField=new Float32Array(w*h);
  let min=1,max=0,sum=0,visible=0;

  for(let p=0;p<heightField.length;p++){
    const i=p*4;
    if(data[i+3]<16){heightField[p]=.5;continue}
    const relief=(
      bands.coarseField[p]*profile.coarse+
      bands.midField[p]*profile.mid+
      bands.microField[p]*profile.micro
    )*profile.heightGain;
    const value=clamp(.5+relief,.06,.94);
    heightField[p]=value;
    min=Math.min(min,value);max=Math.max(max,value);sum+=value;visible++;
  }
  return {
    heightField,
    height:scalarMap(heightField,albedo,"absolute"),
    stats:{
      visiblePixels:visible,
      minHeight:visible?Number(min.toFixed(4)):.5,
      maxHeight:visible?Number(max.toFixed(4)):.5,
      meanHeight:visible?Number((sum/visible).toFixed(4)):.5,
      reliefRange:visible?Number((max-min).toFixed(4)):0,
    },
  };
}

/** Stage 5: tangent-space normal generated only from the merged height field. */
export function normalFromHeight(albedo,heightField,material="generic"){
  const {width:w,height:h,data}=albedo;
  const profile=MATERIAL_HEIGHT_PROFILES[material]||MATERIAL_HEIGHT_PROFILES.generic;
  const mask=visibilityMask(albedo);
  const normalData=new Uint8ClampedArray(w*h*4);

  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x,i=p*4,alpha=data[i+3];
    if(alpha<16){
      normalData[i]=128;normalData[i+1]=128;normalData[i+2]=255;normalData[i+3]=alpha;
      continue;
    }
    // 3x3 Sobel derivative is less noisy than a two-sample central difference on upscaled textures.
    const center=heightField[p];
    const tl=fieldAtVisible(heightField,mask,w,h,x-1,y-1,center),tc=fieldAtVisible(heightField,mask,w,h,x,y-1,center),tr=fieldAtVisible(heightField,mask,w,h,x+1,y-1,center);
    const ml=fieldAtVisible(heightField,mask,w,h,x-1,y,center),mr=fieldAtVisible(heightField,mask,w,h,x+1,y,center);
    const bl=fieldAtVisible(heightField,mask,w,h,x-1,y+1,center),bc=fieldAtVisible(heightField,mask,w,h,x,y+1,center),br=fieldAtVisible(heightField,mask,w,h,x+1,y+1,center);
    const dx=((tr+2*mr+br)-(tl+2*ml+bl))*.25*profile.normalStrength;
    const dy=((bl+2*bc+br)-(tl+2*tc+tr))*.25*profile.normalStrength;
    let nx=-dx,ny=-dy,nz=1;
    const length=Math.hypot(nx,ny,nz)||1;nx/=length;ny/=length;nz/=length;
    normalData[i]=clamp8((nx*.5+.5)*255);
    normalData[i+1]=clamp8((ny*.5+.5)*255);
    normalData[i+2]=clamp8((nz*.5+.5)*255);
    normalData[i+3]=alpha;
  }
  return {width:w,height:h,data:normalData};
}

/**
 * Stage 6: derive geometry-aware AO, roughness modulation and optional curvature from merged height.
 * roughnessBase is the material prior; local height structure only modulates it conservatively.
 */
export function deriveHeightSurfaceMaps(albedo,heightField,material="generic",roughnessBase=.58,{curvature=true}={}){
  const {width:w,height:h,data}=albedo;
  const profile=MATERIAL_HEIGHT_PROFILES[material]||MATERIAL_HEIGHT_PROFILES.generic;
  const mask=visibilityMask(albedo);
  const ii=integral(heightField,w,h,mask);
  const aoData=new Uint8ClampedArray(w*h*4);
  const roughData=new Uint8ClampedArray(w*h*4);
  const curvatureData=curvature?new Uint8ClampedArray(w*h*4):null;
  let aoSum=0,roughSum=0,curvSum=0,visible=0;

  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x,i=p*4,alpha=data[i+3];
    if(alpha<16){
      aoData[i]=aoData[i+1]=aoData[i+2]=255;aoData[i+3]=alpha;
      roughData[i]=roughData[i+1]=roughData[i+2]=clamp8(roughnessBase*255);roughData[i+3]=alpha;
      if(curvatureData){curvatureData[i]=curvatureData[i+1]=curvatureData[i+2]=128;curvatureData[i+3]=alpha}
      continue;
    }

    const center=heightField[p];
    const nearMean=meanAt(ii,w,h,x,y,2,center);
    const broadMean=meanAt(ii,w,h,x,y,profile.aoRadius,nearMean);
    const cavity=Math.max(0,(nearMean-center)*.72+(broadMean-center)*.58);
    const ao=clamp(1-cavity*3.1,.34,1);

    const dx=fieldAtVisible(heightField,mask,w,h,x+1,y,center)-fieldAtVisible(heightField,mask,w,h,x-1,y,center);
    const dy=fieldAtVisible(heightField,mask,w,h,x,y+1,center)-fieldAtVisible(heightField,mask,w,h,x,y-1,center);
    const slope=clamp(Math.hypot(dx,dy)*4.5,0,1);
    const detail=clamp(Math.abs(center-nearMean)*5.5,0,1);
    const hard=["metal","weapon","glass"].includes(material);
    const rough=clamp(roughnessBase+detail*(hard?.07:.13)+slope*(hard?.035:.07),.04,.98);

    const a8=clamp8(ao*255),r8=clamp8(rough*255);
    aoData[i]=aoData[i+1]=aoData[i+2]=a8;aoData[i+3]=alpha;
    roughData[i]=roughData[i+1]=roughData[i+2]=r8;roughData[i+3]=alpha;

    if(curvatureData){
      const lap=(
        fieldAtVisible(heightField,mask,w,h,x-1,y,center)+fieldAtVisible(heightField,mask,w,h,x+1,y,center)+
        fieldAtVisible(heightField,mask,w,h,x,y-1,center)+fieldAtVisible(heightField,mask,w,h,x,y+1,center)-center*4
      );
      // Signed curvature: concave below 0.5, convex above 0.5.
      const cv=clamp(.5+lap*3.2,.02,.98);
      const c8=clamp8(cv*255);
      curvatureData[i]=curvatureData[i+1]=curvatureData[i+2]=c8;curvatureData[i+3]=alpha;
      curvSum+=cv;
    }
    aoSum+=ao;roughSum+=rough;visible++;
  }

  return {
    ao:{width:w,height:h,data:aoData},
    roughness:{width:w,height:h,data:roughData},
    curvature:curvatureData?{width:w,height:h,data:curvatureData}:null,
    stats:{
      visiblePixels:visible,
      meanAo:visible?Number((aoSum/visible).toFixed(4)):1,
      meanRoughness:visible?Number((roughSum/visible).toFixed(4)):roughnessBase,
      meanCurvature:curvatureData&&visible?Number((curvSum/visible).toFixed(4)):null,
    },
  };
}

/**
 * Backwards-compatible convenience wrapper used by tests and callers that only need final height/normal.
 */
export function deriveMultiScaleHeight(albedo,material="generic"){
  const bands=deriveHeightBands(albedo,material);
  const merged=mergeHeightBands(albedo,bands,material);
  const normal=normalFromHeight(albedo,merged.heightField,material);
  return {
    heightField:merged.heightField,
    height:merged.height,
    normal,
    bands:{coarse:bands.coarse,mid:bands.mid,micro:bands.micro},
    profile:bands.profile,
    stats:{
      ...merged.stats,
      coarseEnergy:bands.stats.coarse.meanAbs,
      midEnergy:bands.stats.mid.meanAbs,
      microEnergy:bands.stats.micro.meanAbs,
    },
  };
}
