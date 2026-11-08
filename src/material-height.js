// SPDX-License-Identifier: GPL-3.0-or-later
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const luma=(r,g,b)=>(54*r+183*g+19*b)/256;

export const MATERIAL_HEIGHT_PROFILES=Object.freeze({
  generic:Object.freeze({coarseRadius:7,midRadius:3,coarse:.28,mid:.62,micro:.72,heightGain:1.55,normalStrength:2.4}),
  terrain:Object.freeze({coarseRadius:12,midRadius:4,coarse:.58,mid:.90,micro:.82,heightGain:1.95,normalStrength:3.8}),
  stone:Object.freeze({coarseRadius:10,midRadius:3,coarse:.52,mid:1.08,micro:1.18,heightGain:2.15,normalStrength:4.8}),
  metal:Object.freeze({coarseRadius:7,midRadius:2,coarse:.12,mid:.82,micro:.38,heightGain:1.65,normalStrength:3.2}),
  fabric:Object.freeze({coarseRadius:5,midRadius:2,coarse:.08,mid:.48,micro:1.32,heightGain:1.80,normalStrength:4.1}),
  organic:Object.freeze({coarseRadius:8,midRadius:3,coarse:.34,mid:.72,micro:.68,heightGain:1.55,normalStrength:2.8}),
  character:Object.freeze({coarseRadius:7,midRadius:3,coarse:.18,mid:.42,micro:.38,heightGain:1.15,normalStrength:1.8}),
  weapon:Object.freeze({coarseRadius:7,midRadius:2,coarse:.16,mid:.92,micro:.52,heightGain:1.85,normalStrength:3.7}),
  energy:Object.freeze({coarseRadius:7,midRadius:3,coarse:.06,mid:.12,micro:.08,heightGain:.55,normalStrength:.65}),
  glass:Object.freeze({coarseRadius:7,midRadius:3,coarse:.03,mid:.08,micro:.04,heightGain:.35,normalStrength:.35}),
  sky:Object.freeze({coarseRadius:12,midRadius:5,coarse:.04,mid:.06,micro:.02,heightGain:.30,normalStrength:.25}),
  ui:Object.freeze({coarseRadius:5,midRadius:2,coarse:.02,mid:.05,micro:.03,heightGain:.25,normalStrength:.25}),
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

function integral(field,w,h){
  const stride=w+1;
  const sum=new Float64Array((w+1)*(h+1));
  for(let y=1;y<=h;y++){
    let row=0;
    for(let x=1;x<=w;x++){
      row+=field[(y-1)*w+(x-1)];
      sum[y*stride+x]=sum[(y-1)*stride+x]+row;
    }
  }
  return {sum,stride};
}

function meanAt(ii,w,h,x,y,radius){
  const x0=Math.max(0,x-radius),y0=Math.max(0,y-radius);
  const x1=Math.min(w-1,x+radius),y1=Math.min(h-1,y+radius);
  const s=ii.stride;
  const ax=x0,ay=y0,bx=x1+1,by=y1+1;
  const sum=ii.sum[by*s+bx]-ii.sum[ay*s+bx]-ii.sum[by*s+ax]+ii.sum[ay*s+ax];
  return sum/Math.max(1,(x1-x0+1)*(y1-y0+1));
}

function fieldAt(field,w,h,x,y){
  const xx=Math.max(0,Math.min(w-1,x));
  const yy=Math.max(0,Math.min(h-1,y));
  return field[yy*w+xx];
}

/**
 * Reconstructs a lighting-resistant relative height field from a de-lit albedo image.
 * The three bands are non-overlapping:
 *   micro  = pixel - 1px neighbourhood
 *   mid    = 1px neighbourhood - mid neighbourhood
 *   coarse = mid neighbourhood - broad neighbourhood
 * Absolute albedo brightness is intentionally not treated as absolute geometry.
 */
export function deriveMultiScaleHeight(albedo,material="generic"){
  const {width:w,height:h,data}=albedo;
  const profile=MATERIAL_HEIGHT_PROFILES[material]||MATERIAL_HEIGHT_PROFILES.generic;
  const lum=luminance(albedo);
  const ii=integral(lum,w,h);
  const heightField=new Float32Array(w*h);
  let coarseEnergy=0,midEnergy=0,microEnergy=0;
  let min=1,max=0,sum=0,visible=0;

  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x,i=p*4;
    if(data[i+3]<16){heightField[p]=.5;continue}
    const center=lum[p];
    const local=meanAt(ii,w,h,x,y,1);
    const midMean=meanAt(ii,w,h,x,y,profile.midRadius);
    const coarseMean=meanAt(ii,w,h,x,y,profile.coarseRadius);

    const micro=center-local;
    const mid=local-midMean;
    const coarse=midMean-coarseMean;
    coarseEnergy+=Math.abs(coarse);
    midEnergy+=Math.abs(mid);
    microEnergy+=Math.abs(micro);

    const relief=(
      coarse*profile.coarse+
      mid*profile.mid+
      micro*profile.micro
    )*profile.heightGain;
    const value=clamp(.5+relief,.06,.94);
    heightField[p]=value;
    min=Math.min(min,value);max=Math.max(max,value);sum+=value;visible++;
  }

  // Derive a normalized tangent-space normal field from the merged height.
  const normalData=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x,i=p*4;
    const alpha=data[i+3];
    if(alpha<16){
      normalData[i]=128;normalData[i+1]=128;normalData[i+2]=255;normalData[i+3]=alpha;
      continue;
    }
    const dx=(fieldAt(heightField,w,h,x+1,y)-fieldAt(heightField,w,h,x-1,y))*profile.normalStrength;
    const dy=(fieldAt(heightField,w,h,x,y+1)-fieldAt(heightField,w,h,x,y-1))*profile.normalStrength;
    let nx=-dx,ny=-dy,nz=1;
    const length=Math.hypot(nx,ny,nz)||1;
    nx/=length;ny/=length;nz/=length;
    normalData[i]=Math.round(clamp(nx*.5+.5,0,1)*255);
    normalData[i+1]=Math.round(clamp(ny*.5+.5,0,1)*255);
    normalData[i+2]=Math.round(clamp(nz*.5+.5,0,1)*255);
    normalData[i+3]=alpha;
  }

  return {
    heightField,
    normal:{width:w,height:h,data:normalData},
    profile:{...profile},
    stats:{
      visiblePixels:visible,
      minHeight:visible?Number(min.toFixed(4)):.5,
      maxHeight:visible?Number(max.toFixed(4)):.5,
      meanHeight:visible?Number((sum/visible).toFixed(4)):.5,
      coarseEnergy:visible?Number((coarseEnergy/visible).toFixed(6)):0,
      midEnergy:visible?Number((midEnergy/visible).toFixed(6)):0,
      microEnergy:visible?Number((microEnergy/visible).toFixed(6)):0,
      reliefRange:visible?Number((max-min).toFixed(4)):0,
    },
  };
}
