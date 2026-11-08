// SPDX-License-Identifier: GPL-3.0-or-later
export const PROFILE = {
  faithful: {residual:0.28, sharpen:0.04},
  balanced: {residual:0.44, sharpen:0.16},
  enhanced: {residual:0.56, sharpen:0.30},
};

export const DETAIL_QUALITY = {
  standard: {fine:1.00, mid:0.00, sharpenScale:1.00},
  high: {fine:1.18, mid:0.12, sharpenScale:0.50},
  max: {fine:1.34, mid:0.22, sharpenScale:0.00},
};

const CLASS_GAIN = {
  diffuse:1.0,
  sky:0.9,
  ui:0.55,
  normal:0,
  mask:0,
};

const clamp8 = (value) => Math.max(0, Math.min(255, Math.round(value)));
const at = (width,x,y)=>(y*width+x)*4;
const luma=(r,g,b)=>(54*r+183*g+19*b)>>8;

function meanRadius(source,width,height,x,y,radius) {
  const rgb=[0,0,0];
  let count=0, closeBright=0;
  const si=at(width,x,y);
  const center=luma(source[si],source[si+1],source[si+2]);
  for(let yy=Math.max(0,y-radius);yy<=Math.min(height-1,y+radius);yy++){
    for(let xx=Math.max(0,x-radius);xx<=Math.min(width-1,x+radius);xx++){
      if(xx===x&&yy===y)continue;
      const i=at(width,xx,yy);
      if(source[i+3]<16)continue;
      rgb[0]+=source[i];rgb[1]+=source[i+1];rgb[2]+=source[i+2];count++;
      if(luma(source[i],source[i+1],source[i+2])>=center-24)closeBright++;
    }
  }
  if(!count)return {rgb:[source[si],source[si+1],source[si+2]],luma:center,closeBright};
  rgb[0]/=count;rgb[1]/=count;rgb[2]/=count;
  return {rgb,luma:luma(rgb[0],rgb[1],rgb[2]),closeBright};
}

function bilinearField(field,width,height,x,y,channel) {
  const x0=Math.max(0,Math.min(width-1,Math.floor(x)));
  const y0=Math.max(0,Math.min(height-1,Math.floor(y)));
  const x1=Math.min(width-1,x0+1), y1=Math.min(height-1,y0+1);
  const fx=Math.max(0,Math.min(1,x-x0)), fy=Math.max(0,Math.min(1,y-y0));
  const a=field[(y0*width+x0)*3+channel];
  const b=field[(y0*width+x1)*3+channel];
  const c=field[(y1*width+x0)*3+channel];
  const d=field[(y1*width+x1)*3+channel];
  return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
}

function restoreStars(source,output,srcWidth,srcHeight,outWidth,outHeight) {
  let stars=0;
  const sx=outWidth/srcWidth, sy=outHeight/srcHeight;
  for(let y=0;y<srcHeight;y++)for(let x=0;x<srcWidth;x++){
    const si=at(srcWidth,x,y);
    if(source[si+3]<16)continue;
    const mean=meanRadius(source,srcWidth,srcHeight,x,y,1);
    const center=luma(source[si],source[si+1],source[si+2]);
    const contrast=center-mean.luma;
    if(!(center>=150&&mean.luma<=112&&contrast>=52&&mean.closeBright<=2))continue;
    const ox=Math.min(outWidth-1,Math.round((x+0.5)*sx-0.5));
    const oy=Math.min(outHeight-1,Math.round((y+0.5)*sy-0.5));
    for(let yy=Math.max(0,oy-1);yy<=Math.min(outHeight-1,oy+1);yy++){
      for(let xx=Math.max(0,ox-1);xx<=Math.min(outWidth-1,ox+1);xx++){
        const oi=at(outWidth,xx,yy);
        output[oi]=Math.max(output[oi],source[si]);
        output[oi+1]=Math.max(output[oi+1],source[si+1]);
        output[oi+2]=Math.max(output[oi+2],source[si+2]);
      }
    }
    stars++;
  }
  return stars;
}

/**
 * Reconstruct source-derived multi-scale structure. High/Max increase genuine source residual
 * contribution while reducing/zeroing the old output-sharpen pass.
 */
export function restoreSourceDetail(sourceData, outputData, mode, preserveMicrodetail, preserveStars, options={}) {
  const profile=PROFILE[mode];
  if(!profile)throw new Error(`unknown AI texture mode: ${mode}`);
  const quality=DETAIL_QUALITY[options.detailQuality]||DETAIL_QUALITY.high;
  const textureClass=options.textureClass||"diffuse";
  const classGain=CLASS_GAIN[textureClass]??1;
  const {data:source,width:srcWidth,height:srcHeight}=sourceData;
  const {data:output,width:outWidth,height:outHeight}=outputData;
  let stars=0,microdetails=0;

  if(preserveMicrodetail&&classGain>0){
    const fine=new Float32Array(srcWidth*srcHeight*3);
    const mid=quality.mid>0?new Float32Array(srcWidth*srcHeight*3):null;

    for(let y=0;y<srcHeight;y++)for(let x=0;x<srcWidth;x++){
      const si=at(srcWidth,x,y);
      if(source[si+3]<16)continue;
      const mean1=meanRadius(source,srcWidth,srcHeight,x,y,1);
      const mean2=mid?meanRadius(source,srcWidth,srcHeight,x,y,2):null;
      const base=(y*srcWidth+x)*3;
      const centerLuma=luma(source[si],source[si+1],source[si+2]);
      const fineContrast=centerLuma-mean1.luma;
      if(Math.abs(fineContrast)>=18)microdetails++;
      for(let c=0;c<3;c++){
        fine[base+c]=(source[si+c]-mean1.rgb[c])*profile.residual*quality.fine*classGain;
        if(mid)mid[base+c]=(mean1.rgb[c]-mean2.rgb[c])*profile.residual*quality.mid*classGain;
      }
    }

    const scaleX=outWidth/srcWidth, scaleY=outHeight/srcHeight;
    for(let y=0;y<outHeight;y++){
      const sy=(y+0.5)/scaleY-0.5;
      for(let x=0;x<outWidth;x++){
        const sx=(x+0.5)/scaleX-0.5;
        const oi=at(outWidth,x,y);
        if(output[oi+3]<16)continue;
        for(let c=0;c<3;c++){
          let residual=bilinearField(fine,srcWidth,srcHeight,sx,sy,c);
          if(mid)residual+=bilinearField(mid,srcWidth,srcHeight,sx,sy,c);
          output[oi+c]=clamp8(output[oi+c]+residual);
        }
      }
    }
  }

  if(preserveStars&&textureClass!=="normal"&&textureClass!=="mask"){
    stars=restoreStars(source,output,srcWidth,srcHeight,outWidth,outHeight);
  }

  const sharpen=profile.sharpen*quality.sharpenScale;
  if(sharpen>0&&outWidth>=3&&outHeight>=3){
    const original=new Uint8ClampedArray(output);
    for(let y=1;y<outHeight-1;y++)for(let x=1;x<outWidth-1;x++){
      const i=at(outWidth,x,y);
      if(original[i+3]<16)continue;
      for(let c=0;c<3;c++){
        const mean=(original[i-4+c]+original[i+4+c]+original[i-outWidth*4+c]+original[i+outWidth*4+c])*0.25;
        const center=original[i+c];
        output[i+c]=clamp8(center+(center-mean)*sharpen);
      }
    }
  }

  return {stars,microdetails,detailQuality:options.detailQuality||"high",textureClass};
}
