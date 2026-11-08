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

export function qualityMetrics(source,output,{cnnAgreement=1,cnnConfidence=cnnAgreement,cnnRejectedRatio=0}={}){
  const sx=output.width/source.width,sy=output.height/source.height;
  let colorDrift=0,lumaDrift=0,alphaDiff=0,sourceEdge=0,outEdge=0,n=0;
  let srcVisible=0,outVisible=0,sumS=0,sumO=0,sumSS=0,sumOO=0,sumSO=0;
  const srcHist=new Uint32Array(16),outHist=new Uint32Array(16);
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
    const si=(y*source.width+x)*4;
    const ox=Math.min(output.width-1,Math.round((x+.5)*sx-.5));
    const oy=Math.min(output.height-1,Math.round((y+.5)*sy-.5));
    const oi=(oy*output.width+ox)*4;
    const sl=luma(source.data[si],source.data[si+1],source.data[si+2]);
    const ol=luma(output.data[oi],output.data[oi+1],output.data[oi+2]);
    const [,scb,scr]=rgbToYCbCr(source.data[si],source.data[si+1],source.data[si+2]);
    const [,ocb,ocr]=rgbToYCbCr(output.data[oi],output.data[oi+1],output.data[oi+2]);
    colorDrift+=(Math.abs(scb-ocb)+Math.abs(scr-ocr))*.5;
    lumaDrift+=Math.abs(sl-ol);
    alphaDiff+=Math.abs(source.data[si+3]-output.data[oi+3]);
    if(source.data[si+3]>=16)srcVisible++;
    if(output.data[oi+3]>=16)outVisible++;
    srcHist[Math.min(15,Math.floor(sl/16))]++;
    outHist[Math.min(15,Math.floor(ol/16))]++;
    sumS+=sl;sumO+=ol;sumSS+=sl*sl;sumOO+=ol*ol;sumSO+=sl*ol;
    if(x+1<source.width){
      const sj=si+4;
      sourceEdge+=Math.abs(sl-luma(source.data[sj],source.data[sj+1],source.data[sj+2]));
      const ox2=Math.min(output.width-1,Math.round((x+1.5)*sx-.5));
      const oj=(oy*output.width+ox2)*4;
      outEdge+=Math.abs(ol-luma(output.data[oj],output.data[oj+1],output.data[oj+2]));
    }
    n++;
  }
  const edgeGain=sourceEdge>0?outEdge/sourceEdge:1;
  const meanColor=n?colorDrift/n:0,meanLuma=n?lumaDrift/n:0,meanAlpha=n?alphaDiff/n:0;
  let histogramDrift=0;
  for(let i=0;i<16;i++)histogramDrift+=Math.abs((srcHist[i]/Math.max(1,n))-(outHist[i]/Math.max(1,n)));
  histogramDrift*=50;
  const alphaCoverageDiff=Math.abs(srcVisible-outVisible)/Math.max(1,n)*100;
  const ms=sumS/Math.max(1,n),mo=sumO/Math.max(1,n);
  const vs=Math.max(0,sumSS/Math.max(1,n)-ms*ms),vo=Math.max(0,sumOO/Math.max(1,n)-mo*mo);
  const cov=sumSO/Math.max(1,n)-ms*mo;
  const c1=6.5025,c2=58.5225;
  const ssim=((2*ms*mo+c1)*(2*cov+c2))/((ms*ms+mo*mo+c1)*(vs+vo+c2));
  const hallucinationScore=clamp(
    (1-cnnAgreement)*30+(1-cnnConfidence)*24+clamp(cnnRejectedRatio,0,1)*30+Math.max(0,edgeGain-1.8)*12+meanColor*.7+histogramDrift*.5,
    0,100
  );
  let seamScore=0,seamN=0;
  if(output.width>2&&output.height>2){
    for(let y=0;y<output.height;y++){
      const a=(y*output.width)*4,b=(y*output.width+output.width-1)*4;
      seamScore+=(Math.abs(output.data[a]-output.data[b])+Math.abs(output.data[a+1]-output.data[b+1])+Math.abs(output.data[a+2]-output.data[b+2]))/3;seamN++;
    }
    for(let x=0;x<output.width;x++){
      const a=x*4,b=((output.height-1)*output.width+x)*4;
      seamScore+=(Math.abs(output.data[a]-output.data[b])+Math.abs(output.data[a+1]-output.data[b+1])+Math.abs(output.data[a+2]-output.data[b+2]))/3;seamN++;
    }
  }
  seamScore=seamN?seamScore/seamN:0;
  const score=clamp(
    100-meanColor*.45-meanLuma*.14-meanAlpha*.20-histogramDrift*.12-alphaCoverageDiff*.25-
    Math.max(0,.55-cnnAgreement)*32-Math.max(0,.45-cnnConfidence)*38-
    Math.max(0,edgeGain-2.8)*8-Math.max(0,hallucinationScore-55)*.18,
    0,100
  );
  return {
    score:Number(score.toFixed(1)),
    colorDrift:Number(meanColor.toFixed(2)),
    lumaDrift:Number(meanLuma.toFixed(2)),
    alphaDrift:Number(meanAlpha.toFixed(2)),
    alphaCoverageDiff:Number(alphaCoverageDiff.toFixed(2)),
    histogramDrift:Number(histogramDrift.toFixed(2)),
    edgeGain:Number(edgeGain.toFixed(2)),
    microdetailGain:Number(Math.max(0,edgeGain-1).toFixed(2)),
    cnnAgreement:Number(cnnAgreement.toFixed(3)),\n    cnnConfidence:Number(cnnConfidence.toFixed(3)),\n    cnnRejectedRatio:Number(clamp(cnnRejectedRatio,0,1).toFixed(3)),
    cnnConfidence:Number(cnnConfidence.toFixed(3)),
    ssim:Number(clamp(ssim,-1,1).toFixed(4)),
    hallucinationScore:Number(hallucinationScore.toFixed(1)),
    seamScore:Number(seamScore.toFixed(2)),
  };
}
