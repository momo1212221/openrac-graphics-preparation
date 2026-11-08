// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Detect only cases where bypassing a neural upscaler is lossless with respect to source content.
 * No variance threshold or heuristic similarity is used.
 */
export function trivialTexture(imageData) {
  const {data, width, height} = imageData;
  if (!width || !height || data.length < 4) return {trivial:false, reason:null};

  let allTransparent = true;
  const r0 = data[0], g0 = data[1], b0 = data[2], a0 = data[3];
  let uniform = true;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0) allTransparent = false;
    if (
      data[i] !== r0 ||
      data[i + 1] !== g0 ||
      data[i + 2] !== b0 ||
      data[i + 3] !== a0
    ) uniform = false;
    if (!allTransparent && !uniform) return {trivial:false, reason:null};
  }

  if (allTransparent) return {trivial:true, reason:"transparent"};
  if (uniform) return {trivial:true, reason:"uniform"};
  return {trivial:false, reason:null};
}


const pixelLuma=(data,i)=>(54*data[i]+183*data[i+1]+19*data[i+2])/256;

export function textureComplexity(imageData){
  const {data,width,height}=imageData;
  if(!width||!height)return 0;
  const target=4096;
  const step=Math.max(1,Math.floor(Math.sqrt((width*height)/target)));
  let edge=0,chroma=0,alpha=0,n=0;
  for(let y=0;y<height;y+=step){
    for(let x=0;x<width;x+=step){
      const i=(y*width+x)*4;
      if(data[i+3]<8)continue;
      const l=pixelLuma(data,i);
      const max=Math.max(data[i],data[i+1],data[i+2]);
      const min=Math.min(data[i],data[i+1],data[i+2]);
      chroma+=(max-min)/255;
      if(x+step<width){
        const j=(y*width+Math.min(width-1,x+step))*4;
        edge+=Math.abs(l-pixelLuma(data,j))/255;
        alpha+=Math.abs(data[i+3]-data[j+3])/255;
      }
      if(y+step<height){
        const j=(Math.min(height-1,y+step)*width+x)*4;
        edge+=Math.abs(l-pixelLuma(data,j))/255;
        alpha+=Math.abs(data[i+3]-data[j+3])/255;
      }
      n++;
    }
  }
  if(!n)return 0;
  const score=(edge/(n*2))*.68+(chroma/n)*.20+(alpha/(n*2))*.12;
  return Math.max(0,Math.min(1,score*2.25));
}
