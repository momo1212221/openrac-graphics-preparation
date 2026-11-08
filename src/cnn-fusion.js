// SPDX-License-Identifier: GPL-3.0-or-later
import {MATERIAL_DETAIL_GAIN} from "./material-classify.js";

const clamp8=(v)=>Math.max(0,Math.min(255,Math.round(v)));
const clamp01=(v)=>Math.max(0,Math.min(1,v));

const QUALITY_GAIN={standard:0,high:.18,max:.30};
const MATERIAL_LIMIT=Object.freeze({
  generic:28,terrain:30,stone:32,metal:28,fabric:30,organic:24,
  character:22,weapon:30,energy:20,glass:16,sky:18,ui:10,normal:0,mask:0,
});

// Fragile/smooth materials intentionally admit very little second-CNN novelty.
 // The x4plus image remains authoritative; enrichment is allowed only where real-CNN
 // regression benchmarks stay inside the per-material fidelity budget.
const MATERIAL_PROFILE=Object.freeze({
  generic:{minConfidence:.12,modelOnlyAllowance:.55,noveltyScale:1.00},
  terrain:{minConfidence:.10,modelOnlyAllowance:.78,noveltyScale:1.05},
  stone:{minConfidence:.10,modelOnlyAllowance:.82,noveltyScale:1.08},
  metal:{minConfidence:.14,modelOnlyAllowance:.52,noveltyScale:.92},
  fabric:{minConfidence:.11,modelOnlyAllowance:.72,noveltyScale:1.02},
  organic:{minConfidence:.15,modelOnlyAllowance:.48,noveltyScale:.86},
  character:{minConfidence:.18,modelOnlyAllowance:.34,noveltyScale:.36},
  weapon:{minConfidence:.14,modelOnlyAllowance:.56,noveltyScale:.85},
  energy:{minConfidence:.18,modelOnlyAllowance:.30,noveltyScale:.07},
  glass:{minConfidence:.22,modelOnlyAllowance:.18,noveltyScale:.20},
  sky:{minConfidence:.20,modelOnlyAllowance:.24,noveltyScale:.16},
  ui:{minConfidence:.28,modelOnlyAllowance:.10,noveltyScale:.30},
  normal:{minConfidence:1,modelOnlyAllowance:0,noveltyScale:0},
  mask:{minConfidence:1,modelOnlyAllowance:0,noveltyScale:0},
});

function crossMean(data,width,height,x,y,c){
  const i=(y*width+x)*4+c;
  let sum=0,n=0;
  if(x>0){sum+=data[i-4];n++}
  if(x+1<width){sum+=data[i+4];n++}
  if(y>0){sum+=data[i-width*4];n++}
  if(y+1<height){sum+=data[i+width*4];n++}
  return n?sum/n:data[i];
}

function residualAt(image,x,y,c){
  const i=(y*image.width+x)*4+c;
  return image.data[i]-crossMean(image.data,image.width,image.height,x,y,c);
}

function structureConfidence(base,detail,x,y){
  let agreement=0,energy=0;
  for(let c=0;c<3;c++){
    const br=residualAt(base,x,y,c);
    const dr=residualAt(detail,x,y,c);
    const scale=Math.max(6,Math.abs(br),Math.abs(dr));
    const local=1-Math.min(1,Math.abs(br-dr)/(scale*1.6));
    const sign=br===0||dr===0||Math.sign(br)===Math.sign(dr)?1:.35;
    agreement+=local*sign;
    energy+=Math.max(Math.abs(br),Math.abs(dr));
  }
  const support=clamp01((energy/3-1.5)/14);
  return clamp01((agreement/3)*(.35+.65*support));
}

/**
 * Fuses a conservative General-x4v3 CNN with the x4plus reconstruction.
 * Only incremental high-frequency structure from the detail CNN is admitted when colour
 * agreement and local residual structure agree. Structure already present in the base CNN
 * is not added a second time, preventing agreement from becoming artificial sharpening.
 */
export function fuseCnnOutputs(base,detail,{quality="high",material="generic"}={}){
  const empty=(image)=>({
    image,agreement:1,confidence:1,confidenceP10:1,lowConfidencePixels:0,
    lowConfidenceRatio:0,detailPixels:0,rejectedPixels:0,consideredPixels:0,
  });
  if(!detail||base.width!==detail.width||base.height!==detail.height)return empty(base);
  const gain=(QUALITY_GAIN[quality]??QUALITY_GAIN.high)*(MATERIAL_DETAIL_GAIN[material]??1);
  if(gain<=0)return empty(base);

  const out={width:base.width,height:base.height,data:new Uint8ClampedArray(base.data)};
  const impulseLimit=MATERIAL_LIMIT[material]??MATERIAL_LIMIT.generic;
  const profile=MATERIAL_PROFILE[material]??MATERIAL_PROFILE.generic;
  const pixels=base.width*base.height;
  const rawConfidence=new Float32Array(pixels);
  const modelSafety=new Float32Array(pixels);
  const visible=new Uint8Array(pixels);
  let agreementSum=0,count=0;

  // Pass 1: local evidence. This preserves the existing material-aware fidelity model.
  for(let y=0;y<base.height;y++){
    for(let x=0;x<base.width;x++){
      const p=y*base.width+x,i=p*4;
      if(base.data[i+3]<16)continue;
      const disagreement=(
        Math.abs(base.data[i]-detail.data[i])+
        Math.abs(base.data[i+1]-detail.data[i+1])+
        Math.abs(base.data[i+2]-detail.data[i+2])
      )/3;
      const colourAgreement=clamp01(1-disagreement/72);
      const structure=structureConfidence(base,detail,x,y);
      let baseEnergy=0,detailEnergy=0;
      for(let ch=0;ch<3;ch++){
        baseEnergy+=Math.abs(residualAt(base,x,y,ch));
        detailEnergy+=Math.abs(residualAt(detail,x,y,ch));
      }
      baseEnergy/=3;detailEnergy/=3;
      const modelOnly=clamp01((detailEnergy-baseEnergy-2)/18);
      const baseSupport=clamp01((baseEnergy-1)/12);
      const safety=1-modelOnly*(1-profile.modelOnlyAllowance)*(1-baseSupport);
      const confidence=clamp01(colourAgreement*(.25+.75*structure)*safety);
      rawConfidence[p]=confidence;
      modelSafety[p]=safety;
      visible[p]=1;
      agreementSum+=colourAgreement;
      count++;
    }
  }

  // Pass 2: regional support. A high-confidence pixel surrounded by weak evidence is
  // reduced, while broad coherent structure keeps its original local confidence.
  let confidenceSum=0,detailPixels=0,rejectedPixels=0,lowConfidencePixels=0;
  const confidenceHistogram=new Uint32Array(21);
  // Perfectly agreeing flat regions define a 0.5125 structural-confidence baseline.
  // Values below 0.51 therefore represent weaker-than-baseline local evidence without
  // classifying stable identical flat output as uncertain.
  const lowThreshold=Math.max(.51,profile.minConfidence+.18);
  for(let y=0;y<base.height;y++){
    for(let x=0;x<base.width;x++){
      const p=y*base.width+x;
      if(!visible[p])continue;
      let neighborhood=0,neighbors=0;
      for(let yy=Math.max(0,y-1);yy<=Math.min(base.height-1,y+1);yy++){
        for(let xx=Math.max(0,x-1);xx<=Math.min(base.width-1,x+1);xx++){
          const q=yy*base.width+xx;
          if(!visible[q])continue;
          neighborhood+=rawConfidence[q];neighbors++;
        }
      }
      neighborhood=neighbors?neighborhood/neighbors:rawConfidence[p];
      const local=rawConfidence[p];
      const supportRatio=local>1e-6?clamp01(neighborhood/local):0;
      const confidence=local*(.60+.40*supportRatio);
      confidenceSum+=confidence;
      confidenceHistogram[Math.min(20,Math.max(0,Math.round(confidence*20)))]++;
      if(confidence<lowThreshold)lowConfidencePixels++;

      const structure=structureConfidence(base,detail,x,y);
      if(confidence<profile.minConfidence || (structure<.10 && confidence<profile.minConfidence+.08)){
        rejectedPixels++;continue;
      }

      const i=p*4;
      let used=false;
      for(let ch=0;ch<3;ch++){
        const detailResidual=residualAt(detail,x,y,ch);
        const baseResidual=residualAt(base,x,y,ch);
        if(Math.abs(detailResidual)<1.5)continue;
        const detailDelta=detailResidual-baseResidual;
        if(Math.abs(detailDelta)<1)continue;
        const residualAgreement=clamp01(1-Math.abs(detailDelta)/
          Math.max(8,Math.abs(detailResidual)+Math.abs(baseResidual)));
        const noveltyGate=(.20+.80*residualAgreement)*profile.noveltyScale;
        const supported=detailDelta*noveltyGate*modelSafety[p];
        const limited=Math.max(-impulseLimit,Math.min(impulseLimit,supported));
        out.data[i+ch]=clamp8(base.data[i+ch]+limited*gain*confidence);
        used=true;
      }
      if(used)detailPixels++;
    }
  }

  const target=Math.max(1,Math.ceil(count*.10));
  let cumulative=0,p10=1;
  for(let bin=0;bin<confidenceHistogram.length;bin++){
    cumulative+=confidenceHistogram[bin];
    if(cumulative>=target){p10=bin/20;break;}
  }
  return {
    image:out,
    agreement:count?agreementSum/count:1,
    confidence:count?confidenceSum/count:1,
    confidenceP10:p10,
    lowConfidencePixels,
    lowConfidenceRatio:count?lowConfidencePixels/count:0,
    detailPixels,
    rejectedPixels,
    consideredPixels:count,
  };
}

export const CNN_FUSION_PROFILES=MATERIAL_PROFILE;
