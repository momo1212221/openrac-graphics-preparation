// SPDX-License-Identifier: GPL-3.0-or-later
import {MATERIAL_DETAIL_GAIN} from "./material-classify.js";

const clamp8=(v)=>Math.max(0,Math.min(255,Math.round(v)));

const QUALITY_GAIN={standard:0,high:.18,max:.30};

function crossMean(data,width,height,x,y,c){
  const i=(y*width+x)*4+c;
  let sum=0,n=0;
  if(x>0){sum+=data[i-4];n++}
  if(x+1<width){sum+=data[i+4];n++}
  if(y>0){sum+=data[i-width*4];n++}
  if(y+1<height){sum+=data[i+width*4];n++}
  return n?sum/n:data[i];
}

/**
 * Fuses a conservative General-x4v3 CNN with the x4plus reconstruction.
 * Only high-frequency structure from the detail CNN is injected. When the two CNNs disagree,
 * contribution is automatically suppressed instead of trusting a hallucinated feature.
 */
export function fuseCnnOutputs(base,detail,{quality="high",material="generic"}={}){
  if(!detail||base.width!==detail.width||base.height!==detail.height)return {image:base,agreement:1,detailPixels:0};
  const gain=(QUALITY_GAIN[quality]??QUALITY_GAIN.high)*(MATERIAL_DETAIL_GAIN[material]??1);
  if(gain<=0)return {image:base,agreement:1,detailPixels:0};

  const out={width:base.width,height:base.height,data:new Uint8ClampedArray(base.data)};
  let agreementSum=0,detailPixels=0,count=0;
  for(let y=0;y<base.height;y++){
    for(let x=0;x<base.width;x++){
      const i=(y*base.width+x)*4;
      if(base.data[i+3]<16)continue;
      const disagreement=(
        Math.abs(base.data[i]-detail.data[i])+
        Math.abs(base.data[i+1]-detail.data[i+1])+
        Math.abs(base.data[i+2]-detail.data[i+2])
      )/3;
      const confidence=Math.max(0,Math.min(1,1-disagreement/72));
      agreementSum+=confidence;count++;
      if(confidence<.15)continue;

      let used=false;
      for(let c=0;c<3;c++){
        const residual=detail.data[i+c]-crossMean(detail.data,detail.width,detail.height,x,y,c);
        // Ignore tiny noise and cap extreme model-only impulses.
        if(Math.abs(residual)<1.5)continue;
        const limited=Math.max(-28,Math.min(28,residual));
        out.data[i+c]=clamp8(base.data[i+c]+limited*gain*confidence);
        used=true;
      }
      if(used)detailPixels++;
    }
  }
  return {image:out,agreement:count?agreementSum/count:1,detailPixels};
}
