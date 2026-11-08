// SPDX-License-Identifier: GPL-3.0-or-later
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const at=(w,x,y)=>(y*w+x)*4;

function alphaAt(source,x,y){
  const {width:w,height:h,data}=source;
  const x0=clamp(Math.floor(x),0,w-1),y0=clamp(Math.floor(y),0,h-1);
  const x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1);
  const fx=clamp(x-x0,0,1),fy=clamp(y-y0,0,1);
  const a00=data[at(w,x0,y0)+3],a10=data[at(w,x1,y0)+3];
  const a01=data[at(w,x0,y1)+3],a11=data[at(w,x1,y1)+3];
  const top=a00*(1-fx)+a10*fx,bottom=a01*(1-fx)+a11*fx;
  return top*(1-fy)+bottom*fy;
}

function localAlphaRange(source,x,y){
  const {width:w,height:h,data}=source;
  const cx=clamp(Math.round(x),0,w-1),cy=clamp(Math.round(y),0,h-1);
  let lo=255,hi=0;
  for(let yy=Math.max(0,cy-1);yy<=Math.min(h-1,cy+1);yy++){
    for(let xx=Math.max(0,cx-1);xx<=Math.min(w-1,cx+1);xx++){
      const a=data[at(w,xx,yy)+3];
      lo=Math.min(lo,a);hi=Math.max(hi,a);
    }
  }
  return {lo,hi};
}

export function alphaProfile(source){
  const {data}=source;
  let transparent=0,opaque=0,partial=0,total=0,covered=0;
  for(let i=3;i<data.length;i+=4){
    const a=data[i];total++;
    if(a<=16)transparent++;
    else if(a>=239)opaque++;
    else partial++;
    if(a>=128)covered++;
  }
  const visible=transparent+opaque+partial;
  return {
    hasTransparency:transparent>0||partial>0,
    hardCutout:transparent>0&&opaque>0&&partial/Math.max(1,visible)<.15,
    transparentPixels:transparent,
    opaquePixels:opaque,
    partialPixels:partial,
    coverage128:total?covered/total:0,
  };
}

function histogramThreshold(output,targetCoverage){
  const hist=new Uint32Array(256);
  for(let i=3;i<output.data.length;i+=4)hist[output.data[i]]++;
  const total=output.width*output.height;
  const target=Math.round(clamp(targetCoverage,0,1)*total);
  let above=0;
  for(let a=255;a>=0;a--){
    above+=hist[a];
    if(above>=target)return a;
  }
  return 0;
}

function nearestOpaqueRgb(output,x,y,radius=3){
  const {width:w,height:h,data}=output;
  let best=null,bestD=Infinity;
  for(let yy=Math.max(0,y-radius);yy<=Math.min(h-1,y+radius);yy++){
    for(let xx=Math.max(0,x-radius);xx<=Math.min(w-1,x+radius);xx++){
      const i=at(w,xx,yy),a=data[i+3];
      if(a<128)continue;
      const d=(xx-x)*(xx-x)+(yy-y)*(yy-y);
      if(d<bestD){bestD=d;best=[data[i],data[i+1],data[i+2]];}
    }
  }
  return best;
}

/**
 * Rebuilds alpha from the original texture instead of trusting neural RGB tiles.
 * Hard cutouts preserve >=128 coverage; soft smoke/glow alpha stays continuous.
 * Low-alpha edge colours are gently dilated from nearby visible pixels to suppress fringes.
 */
export function reconstructAlphaEdges(source,output,{dilateRadius=3}={}){
  const profile=alphaProfile(source);
  if(!profile.hasTransparency){
    for(let i=3;i<output.data.length;i+=4)output.data[i]=255;
    return {...profile,edgePixels:0,colorDilatedPixels:0,alphaBias:0,coverageBefore:1,coverageAfter:1,coverageErrorPercent:0};
  }

  const sx=source.width/output.width,sy=source.height/output.height;
  let edgePixels=0,coverageBefore=0;
  for(let y=0;y<output.height;y++)for(let x=0;x<output.width;x++){
    const px=(x+.5)*sx-.5,py=(y+.5)*sy-.5;
    let a=alphaAt(source,px,py);
    const range=localAlphaRange(source,px,py);
    if(range.hi-range.lo>96){
      edgePixels++;
      const t=clamp(a/255,0,1);
      const smooth=t*t*(3-2*t);
      const strength=profile.hardCutout?.35:.12;
      a=255*(t*(1-strength)+smooth*strength);
    }
    const oi=at(output.width,x,y)+3;
    output.data[oi]=clamp(Math.round(a),0,255);
    if(output.data[oi]>=128)coverageBefore++;
  }

  coverageBefore/=Math.max(1,output.width*output.height);
  let alphaBias=0;
  if(profile.hardCutout){
    const threshold=histogramThreshold(output,profile.coverage128);
    alphaBias=clamp(128-threshold,-48,48);
    if(alphaBias){
      for(let i=3;i<output.data.length;i+=4){
        output.data[i]=clamp(output.data[i]+alphaBias,0,255);
      }
    }
  }

  let coverageAfter=0,colorDilatedPixels=0;
  for(let y=0;y<output.height;y++)for(let x=0;x<output.width;x++){
    const i=at(output.width,x,y),a=output.data[i+3];
    if(a>=128)coverageAfter++;
    if(a<=0||a>=128)continue;
    const rgb=nearestOpaqueRgb(output,x,y,dilateRadius);
    if(!rgb)continue;
    const mix=(1-a/128)*.55;
    output.data[i]=Math.round(output.data[i]*(1-mix)+rgb[0]*mix);
    output.data[i+1]=Math.round(output.data[i+1]*(1-mix)+rgb[1]*mix);
    output.data[i+2]=Math.round(output.data[i+2]*(1-mix)+rgb[2]*mix);
    colorDilatedPixels++;
  }
  coverageAfter/=Math.max(1,output.width*output.height);

  return {
    ...profile,
    edgePixels,
    colorDilatedPixels,
    alphaBias,
    coverageBefore:Number(coverageBefore.toFixed(4)),
    coverageAfter:Number(coverageAfter.toFixed(4)),
    coverageErrorPercent:Number((Math.abs(coverageAfter-profile.coverage128)*100).toFixed(2)),
  };
}
