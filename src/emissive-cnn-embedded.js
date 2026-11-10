// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental offline-only 3-layer convolutional emission segmenter.
// Trained on illustrative synthetic backgrounds/lamps, not game textures.
// Runs during material ZIP generation, never during game rendering.
import {emissiveCnnWeights} from './emissive-cnn-weights.js';

export const EMBEDDED_EMISSIVE_CNN_VERSION=1;
export const EMBEDDED_EMISSIVE_CNN_ANALYSIS_MAX=512;
export const EMBEDDED_EMISSIVE_CNN_SHA256='d74242932d11bee61a2bbd5dee1cff210b43a5d5b76fe1a8983cd70c42d9de33';

const W=emissiveCnnWeights.weights;
const clamp=(x,min,max)=>x<min?min:x>max?max:x;
const valid=(im)=>im&&Number.isSafeInteger(im.width)&&Number.isSafeInteger(im.height)&&
  im.width>0&&im.height>0&&im.width<=16384&&im.height<=16384&&
  im.width*im.height<=64*1024*1024&&
  (im.data instanceof Uint8Array||im.data instanceof Uint8ClampedArray)&&
  im.data.length===im.width*im.height*4;

function conv(input,width,height,inChannels,outChannels,weight,bias,kernel){
  const out=new Float32Array(width*height*outChannels);
  const pad=kernel>>1,plane=width*height;
  for(let oc=0;oc<outChannels;oc++){
    const offset=oc*plane;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      let sum=bias[oc];
      for(let ic=0;ic<inChannels;ic++){
        const wBase=(oc*inChannels+ic)*kernel*kernel,pBase=ic*plane;
        for(let ky=0;ky<kernel;ky++){
          const yy=y+ky-pad;
          if(yy<0||yy>=height)continue;
          for(let kx=0;kx<kernel;kx++){
            const xx=x+kx-pad;
            if(xx>=0&&xx<width)sum+=input[pBase+yy*width+xx]*weight[wBase+ky*kernel+kx];
          }
        }
      }
      out[offset+y*width+x]=outChannels===1?sum:Math.max(0,sum);
    }
  }
  return out;
}
function inferenceTile(tile,side){
  const a=conv(tile,side,side,3,4,W['c1.weight'],W['c1.bias'],3);
  const b=conv(a,side,side,4,4,W['c2.weight'],W['c2.bias'],3);
  return conv(b,side,side,4,1,W['c3.weight'],W['c3.bias'],1);
}
function downsample(image,scale){
  const width=Math.ceil(image.width/scale),height=Math.ceil(image.height/scale);
  const rgb=new Float32Array(3*width*height),pixels=width*height;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const total=[0,0,0];let count=0;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
      const xx=Math.min(image.width-1,x*scale+Math.floor((dx+.25)*scale/2));
      const yy=Math.min(image.height-1,y*scale+Math.floor((dy+.25)*scale/2));
      const i=(yy*image.width+xx)*4;
      if(image.data[i+3]<16)continue;
      for(let c=0;c<3;c++)total[c]+=image.data[i+c]/255;
      count++;
    }
    const at=y*width+x;
    for(let c=0;c<3;c++)rgb[c*pixels+at]=count?total[c]/count:0;
  }
  return {width,height,rgb};
}

/**
 * A same-resolution probability mask for emissive-cnn-fusion.js.
 * The original 4x upscaled source and its persistent cache are never modified.
 * Inference is capped to 512px analysis resolution for bounded offline work.
 */
export async function predictEmissiveEmbedded(image,{onProgress=()=>{},shouldCancel=()=>false,yieldControl=null}={}){
  if(!valid(image))throw new TypeError('expected valid RGBA8 image');
  const scale=Math.ceil(Math.max(image.width,image.height)/EMBEDDED_EMISSIVE_CNN_ANALYSIS_MAX);
  const {width:aw,height:ah,rgb}=downsample(image,scale);
  const side=128,halo=2,core=side-halo*2;
  const compact=new Float32Array(aw*ah);
  const total=Math.ceil(aw/core)*Math.ceil(ah/core);let done=0;
  for(let tileY=0;tileY<ah;tileY+=core)for(let tileX=0;tileX<aw;tileX+=core){
    if(shouldCancel())throw new Error('emissive CNN cancelled');
    const data=new Float32Array(3*side*side);
    for(let ch=0;ch<3;ch++)for(let ty=0;ty<side;ty++){
      const sy=tileY+ty-halo;
      if(sy<0||sy>=ah)continue;
      for(let tx=0;tx<side;tx++){
        const sx=tileX+tx-halo;
        if(sx<0||sx>=aw)continue;
        data[ch*side*side+ty*side+tx]=rgb[ch*aw*ah+sy*aw+sx];
      }
    }
    const logits=inferenceTile(data,side);
    for(let y=0;y<core&&tileY+y<ah;y++)for(let x=0;x<core&&tileX+x<aw;x++){
      const raw=clamp(logits[(y+halo)*side+x+halo],-40,40);
      compact[(tileY+y)*aw+tileX+x]=1/(1+Math.exp(-raw));
    }
    done++;
    onProgress({done,total,analysisWidth:aw,analysisHeight:ah});
    if(yieldControl)await yieldControl();
  }
  const probabilities=new Float32Array(image.width*image.height);
  for(let y=0;y<image.height;y++){
    const fy=(y+.5)/scale-.5,y0=clamp(Math.floor(fy),0,ah-1);
    const y1=Math.min(y0+1,ah-1),ty=clamp(fy-y0,0,1);
    for(let x=0;x<image.width;x++){
      const i=(y*image.width+x)*4;
      if(image.data[i+3]<16)continue;
      const fx=(x+.5)/scale-.5,x0=clamp(Math.floor(fx),0,aw-1);
      const x1=Math.min(x0+1,aw-1),tx=clamp(fx-x0,0,1);
      const a=compact[y0*aw+x0]*(1-tx)+compact[y0*aw+x1]*tx;
      const b=compact[y1*aw+x0]*(1-tx)+compact[y1*aw+x1]*tx;
      probabilities[y*image.width+x]=a*(1-ty)+b*ty;
    }
  }
  return {width:image.width,height:image.height,probabilities,analysisWidth:aw,analysisHeight:ah};
}
