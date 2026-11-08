// SPDX-License-Identifier: GPL-3.0-or-later
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const luma=(r,g,b)=>(54*r+183*g+19*b)/256;

function rgbToYCbCr(r,g,b){
  const y=.299*r+.587*g+.114*b;
  return [y,128-.168736*r-.331264*g+.5*b,128+.5*r-.418688*g-.081312*b];
}
function yCbCrToRgb(y,cb,cr){
  return [
    y+1.402*(cr-128),
    y-.344136*(cb-128)-.714136*(cr-128),
    y+1.772*(cb-128),
  ];
}

export function lockSourceChroma(source,output,strength=.7){
  if(!(strength>0))return output;
  const sx=source.width/output.width,sy=source.height/output.height;
  for(let y=0;y<output.height;y++)for(let x=0;x<output.width;x++){
    const ox=(y*output.width+x)*4;
    if(output.data[ox+3]<16)continue;
    const ix=Math.max(0,Math.min(source.width-1,Math.floor((x+.5)*sx)));
    const iy=Math.max(0,Math.min(source.height-1,Math.floor((y+.5)*sy)));
    const si=(iy*source.width+ix)*4;
    const [oy,ocb,ocr]=rgbToYCbCr(output.data[ox],output.data[ox+1],output.data[ox+2]);
    const [,scb,scr]=rgbToYCbCr(source.data[si],source.data[si+1],source.data[si+2]);
    const cb=ocb+(scb-ocb)*strength,cr=ocr+(scr-ocr)*strength;
    const [r,g,b]=yCbCrToRgb(oy,cb,cr);
    output.data[ox]=clamp(Math.round(r),0,255);
    output.data[ox+1]=clamp(Math.round(g),0,255);
    output.data[ox+2]=clamp(Math.round(b),0,255);
  }
  return output;
}

export function qualityMetrics(source,output,{cnnAgreement=1}={}){
  const sx=output.width/source.width,sy=output.height/source.height;
  let colorDrift=0,lumaDrift=0,alphaDiff=0,sourceEdge=0,outEdge=0,n=0;
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
    const si=(y*source.width+x)*4;
    const ox=Math.min(output.width-1,Math.round((x+.5)*sx-.5));
    const oy=Math.min(output.height-1,Math.round((y+.5)*sy-.5));
    const oi=(oy*output.width+ox)*4;
    const [,scb,scr]=rgbToYCbCr(source.data[si],source.data[si+1],source.data[si+2]);
    const [,ocb,ocr]=rgbToYCbCr(output.data[oi],output.data[oi+1],output.data[oi+2]);
    colorDrift+=(Math.abs(scb-ocb)+Math.abs(scr-ocr))*.5;
    lumaDrift+=Math.abs(
      luma(source.data[si],source.data[si+1],source.data[si+2])-
      luma(output.data[oi],output.data[oi+1],output.data[oi+2])
    );
    alphaDiff+=Math.abs(source.data[si+3]-output.data[oi+3]);
    if(x+1<source.width){
      const sj=si+4;
      sourceEdge+=Math.abs(luma(source.data[si],source.data[si+1],source.data[si+2])-luma(source.data[sj],source.data[sj+1],source.data[sj+2]));
      const ox2=Math.min(output.width-1,Math.round((x+1.5)*sx-.5));
      const oj=(oy*output.width+ox2)*4;
      outEdge+=Math.abs(luma(output.data[oi],output.data[oi+1],output.data[oi+2])-luma(output.data[oj],output.data[oj+1],output.data[oj+2]));
    }
    n++;
  }
  const edgeGain=sourceEdge>0?outEdge/sourceEdge:1;
  const meanColor=n?colorDrift/n:0,meanLuma=n?lumaDrift/n:0,meanAlpha=n?alphaDiff/n:0;
  const score=clamp(
    100-meanColor*.55-meanLuma*.18-meanAlpha*.25-Math.max(0,.55-cnnAgreement)*55-Math.max(0,edgeGain-2.8)*8,
    0,100
  );
  return {
    score:Number(score.toFixed(1)),
    colorDrift:Number(meanColor.toFixed(2)),
    lumaDrift:Number(meanLuma.toFixed(2)),
    alphaDrift:Number(meanAlpha.toFixed(2)),
    edgeGain:Number(edgeGain.toFixed(2)),
    cnnAgreement:Number(cnnAgreement.toFixed(3)),
  };
}
