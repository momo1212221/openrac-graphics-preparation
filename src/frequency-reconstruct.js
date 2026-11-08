// SPDX-License-Identifier: GPL-3.0-or-later
const clamp8=(v)=>Math.max(0,Math.min(255,Math.round(v)));
const idx=(w,x,y,c=0)=>((y*w+x)*4+c);

function boxMean(data,w,h,x,y,r,c){
  let sum=0,n=0;
  for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r);yy++){
    for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx++){
      const i=idx(w,xx,yy,c);
      if(data[i+(3-c)]===0&&c===0){} // keep deterministic traversal; alpha handled by caller
      sum+=data[i];n++;
    }
  }
  return n?sum/n:data[idx(w,x,y,c)];
}

export function buildFrequencyBands(imageData){
  const {data,width,height}=imageData;
  const fine=new Float32Array(width*height*3);
  const mid=new Float32Array(width*height*3);
  const coarse=new Float32Array(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const a=data[idx(width,x,y,3)];
    if(a<16)continue;
    const base=(y*width+x)*3;
    for(let c=0;c<3;c++){
      const center=data[idx(width,x,y,c)];
      const m1=boxMean(data,width,height,x,y,1,c);
      const m2=boxMean(data,width,height,x,y,2,c);
      const m4=boxMean(data,width,height,x,y,4,c);
      fine[base+c]=center-m1;
      mid[base+c]=m1-m2;
      coarse[base+c]=m2-m4;
    }
  }
  return {fine,mid,coarse,width,height};
}

function bilinear(field,w,h,x,y,c){
  const x0=Math.max(0,Math.min(w-1,Math.floor(x))),y0=Math.max(0,Math.min(h-1,Math.floor(y)));
  const x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1);
  const fx=Math.max(0,Math.min(1,x-x0)),fy=Math.max(0,Math.min(1,y-y0));
  const at=(xx,yy)=>field[(yy*w+xx)*3+c];
  return (at(x0,y0)*(1-fx)+at(x1,y0)*fx)*(1-fy)+(at(x0,y1)*(1-fx)+at(x1,y1)*fx)*fy;
}

export function applyFrequencyBands(sourceBands,outputData,{fine=.5,mid=.2,coarse=.08,ceiling=30}={}){
  const {width:sw,height:sh}=sourceBands,{width:ow,height:oh,data}=outputData;
  const sx=ow/sw,sy=oh/sh;
  for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){
    const oi=(y*ow+x)*4;if(data[oi+3]<16)continue;
    const px=(x+.5)/sx-.5,py=(y+.5)/sy-.5;
    for(let c=0;c<3;c++){
      let d=bilinear(sourceBands.fine,sw,sh,px,py,c)*fine+
        bilinear(sourceBands.mid,sw,sh,px,py,c)*mid+
        bilinear(sourceBands.coarse,sw,sh,px,py,c)*coarse;
      d=Math.max(-ceiling,Math.min(ceiling,d));
      data[oi+c]=clamp8(data[oi+c]+d);
    }
  }
  return outputData;
}
