// SPDX-License-Identifier: GPL-3.0-or-later
const rgbDiff=(data,a,b)=>(
  Math.abs(data[a]-data[b])+
  Math.abs(data[a+1]-data[b+1])+
  Math.abs(data[a+2]-data[b+2])
)/3;

function edgeStats(imageData,axis){
  const {data,width,height}=imageData;
  let seam=0,internal=0,n=0;
  if(axis==="x"){
    if(width<3)return {seam:Infinity,internal:0};
    for(let y=0;y<height;y++){
      const left=(y*width)*4,right=(y*width+width-1)*4;
      if(data[left+3]<16||data[right+3]<16)continue;
      seam+=rgbDiff(data,left,right);
      internal+=(
        rgbDiff(data,left,left+4)+
        rgbDiff(data,right,right-4)
      )*.5;n++;
    }
  }else{
    if(height<3)return {seam:Infinity,internal:0};
    for(let x=0;x<width;x++){
      const top=x*4,bottom=((height-1)*width+x)*4;
      if(data[top+3]<16||data[bottom+3]<16)continue;
      seam+=rgbDiff(data,top,bottom);
      internal+=(
        rgbDiff(data,top,top+width*4)+
        rgbDiff(data,bottom,bottom-width*4)
      )*.5;n++;
    }
  }
  return n?{seam:seam/n,internal:internal/n}:{seam:Infinity,internal:0};
}

export function detectTextureWrap(imageData,{textureClass="diffuse",material="generic"}={}){
  if(textureClass==="ui"||textureClass==="normal"||textureClass==="mask")
    return {x:false,y:false,confidence:0};
  const x=edgeStats(imageData,"x"),y=edgeStats(imageData,"y");
  const allows=(s)=>{
    const tolerance=Math.max(5,s.internal*1.45+2);
    return Number.isFinite(s.seam)&&s.seam<=tolerance;
  };
  const wrapX=allows(x),wrapY=allows(y);
  const score=(s)=>Number.isFinite(s.seam)?Math.max(0,Math.min(1,1-s.seam/Math.max(1,s.internal*1.8+6))):0;
  // Sky domes commonly repeat horizontally, while world materials may repeat on either axis.
  const xFinal=wrapX||(textureClass==="sky"&&x.seam<=Math.max(10,x.internal*2+4));
  return {
    x:xFinal,y:wrapY,
    confidence:Number((Math.max(xFinal?score(x):0,wrapY?score(y):0)).toFixed(3)),
    xSeam:Number.isFinite(x.seam)?Number(x.seam.toFixed(2)):null,
    ySeam:Number.isFinite(y.seam)?Number(y.seam.toFixed(2)):null,
    material,
  };
}
