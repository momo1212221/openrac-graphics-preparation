// SPDX-License-Identifier: GPL-3.0-or-later
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const luma=(r,g,b)=>(.2126*r+.7152*g+.0722*b);

export const DELIGHT_STRENGTH=Object.freeze({
  generic:.28,terrain:.42,stone:.38,metal:.18,fabric:.36,organic:.30,
  character:.24,weapon:.18,energy:0,glass:.08,sky:0,
});

function integralFields(image){
  const {width:w,height:h,data}=image;
  const stride=w+1;
  const sum=new Float64Array((w+1)*(h+1));
  const count=new Uint32Array((w+1)*(h+1));
  let globalSum=0,globalCount=0;
  for(let y=1;y<=h;y++){
    let rowSum=0,rowCount=0;
    for(let x=1;x<=w;x++){
      const i=((y-1)*w+(x-1))*4;
      if(data[i+3]>=16){
        rowSum+=luma(data[i]/255,data[i+1]/255,data[i+2]/255);
        rowCount++;
        globalSum+=luma(data[i]/255,data[i+1]/255,data[i+2]/255);
        globalCount++;
      }
      const p=y*stride+x,above=(y-1)*stride+x;
      sum[p]=sum[above]+rowSum;
      count[p]=count[above]+rowCount;
    }
  }
  return {sum,count,stride,globalMean:globalCount?globalSum/globalCount:.5,globalCount};
}

function region(integral,w,h,x,y,radius){
  const x0=Math.max(0,x-radius),y0=Math.max(0,y-radius);
  const x1=Math.min(w-1,x+radius),y1=Math.min(h-1,y+radius);
  const s=integral.stride;
  const ax=x0,ay=y0,bx=x1+1,by=y1+1;
  const value=(field)=>field[by*s+bx]-field[ay*s+bx]-field[by*s+ax]+field[ay*s+ax];
  const n=value(integral.count);
  return n?value(integral.sum)/n:integral.globalMean;
}

function emissiveStrength(emissive,i){
  if(!emissive?.data)return 0;
  return Math.max(emissive.data[i],emissive.data[i+1],emissive.data[i+2])/255;
}

/**
 * Produces a conservative lighting-neutralized albedo candidate for the enhanced renderer.
 * It removes only bounded low-frequency luminance bias, preserves RGB ratios, and protects
 * emissive/high-saturation regions. The stock diffuse texture remains unchanged.
 */
export function deriveAlbedoSidecar(image,emissive=null,material="generic"){
  const {width:w,height:h,data}=image;
  const out={width:w,height:h,data:new Uint8ClampedArray(data)};
  const strength=DELIGHT_STRENGTH[material]??DELIGHT_STRENGTH.generic;
  const radius=Math.max(3,Math.min(16,Math.round(Math.min(w,h)*.035)));
  const integral=integralFields(image);
  let adjustedPixels=0,correctionSum=0,minCorrection=1,maxCorrection=1;
  let sourceLuma=0,outputLuma=0,visible=0;

  if(strength<=0){
    for(let i=0;i<data.length;i+=4){
      if(data[i+3]<16)continue;
      const y=luma(data[i]/255,data[i+1]/255,data[i+2]/255);
      sourceLuma+=y;outputLuma+=y;visible++;
    }
    return {
      image:out,material,strength,radius,adjustedPixels:0,adjustedRatio:0,
      meanCorrection:1,minCorrection:1,maxCorrection:1,
      sourceMeanLuma:Number((sourceLuma/Math.max(1,visible)).toFixed(4)),
      albedoMeanLuma:Number((outputLuma/Math.max(1,visible)).toFixed(4)),
    };
  }

  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4;
    if(data[i+3]<16)continue;
    visible++;
    const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
    const srcLuma=luma(r,g,b);
    sourceLuma+=srcLuma;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    const saturation=mx?((mx-mn)/mx):0;
    const local=region(integral,w,h,x,y,radius);
    const raw=clamp(integral.globalMean/Math.max(.08,local),.78,1.24);
    const emissiveProtect=clamp(emissiveStrength(emissive,i)*1.35,0,1);
    const saturationProtect=clamp((saturation-.55)/.40,0,.65);
    const highlightProtect=clamp((srcLuma-.82)/.18,0,.75);
    const effective=strength*(1-emissiveProtect)*(1-saturationProtect)*(1-highlightProtect);
    const correction=1+(raw-1)*effective;
    correctionSum+=correction;
    minCorrection=Math.min(minCorrection,correction);
    maxCorrection=Math.max(maxCorrection,correction);
    if(Math.abs(correction-1)>.01)adjustedPixels++;

    out.data[i]=Math.round(clamp(r*correction,0,1)*255);
    out.data[i+1]=Math.round(clamp(g*correction,0,1)*255);
    out.data[i+2]=Math.round(clamp(b*correction,0,1)*255);
    out.data[i+3]=data[i+3];
    outputLuma+=luma(out.data[i]/255,out.data[i+1]/255,out.data[i+2]/255);
  }

  return {
    image:out,
    material,
    strength,
    radius,
    adjustedPixels,
    adjustedRatio:Number((adjustedPixels/Math.max(1,visible)).toFixed(4)),
    meanCorrection:Number((correctionSum/Math.max(1,visible)).toFixed(4)),
    minCorrection:Number(minCorrection.toFixed(4)),
    maxCorrection:Number(maxCorrection.toFixed(4)),
    sourceMeanLuma:Number((sourceLuma/Math.max(1,visible)).toFixed(4)),
    albedoMeanLuma:Number((outputLuma/Math.max(1,visible)).toFixed(4)),
  };
}

export function validateAlbedoSidecar(stats){
  if(!stats)return {ok:false,issues:["missing-albedo-delight"]};
  const issues=[];
  if(stats.minCorrection<.78||stats.maxCorrection>1.24)issues.push("albedo-correction-range");
  if(Math.abs(stats.albedoMeanLuma-stats.sourceMeanLuma)>.14)issues.push("albedo-mean-drift");
  if(stats.adjustedRatio>.98&&stats.strength>.35)issues.push("albedo-over-adjusted");
  return {ok:issues.length===0,issues};
}
