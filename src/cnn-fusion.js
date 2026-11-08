// SPDX-License-Identifier: GPL-3.0-or-later
import {MATERIAL_DETAIL_GAIN} from "./material-classify.js";

const clamp8=(v)=>Math.max(0,Math.min(255,Math.round(v)));
const clamp01=(v)=>Math.max(0,Math.min(1,v));

const QUALITY_GAIN={standard:0,high:.18,max:.30};
const MATERIAL_LIMIT=Object.freeze({
  generic:28,terrain:30,stone:32,metal:28,fabric:30,organic:24,
  character:22,weapon:30,energy:20,glass:16,sky:18,ui:10,normal:0,mask:0,
});

const MATERIAL_PROFILE=Object.freeze({
  generic:{minConfidence:.12,modelOnlyAllowance:.55,noveltyScale:1.00},
  terrain:{minConfidence:.10,modelOnlyAllowance:.78,noveltyScale:1.05},
  stone:{minConfidence:.10,modelOnlyAllowance:.82,noveltyScale:1.08},
  metal:{minConfidence:.14,modelOnlyAllowance:.52,noveltyScale:.92},
  fabric:{minConfidence:.11,modelOnlyAllowance:.72,noveltyScale:1.02},
  organic:{minConfidence:.15,modelOnlyAllowance:.48,noveltyScale:.86},
  character:{minConfidence:.18,modelOnlyAllowance:.34,noveltyScale:.72},
  weapon:{minConfidence:.14,modelOnlyAllowance:.56,noveltyScale:.94},
  energy:{minConfidence:.18,modelOnlyAllowance:.30,noveltyScale:.68},
  glass:{minConfidence:.22,modelOnlyAllowance:.18,noveltyScale:.48},
  sky:{minConfidence:.20,modelOnlyAllowance:.24,noveltyScale:.56},
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
  if(!detail||base.width!==detail.width||base.height!==detail.height)
    return {image:base,agreement:1,confidence:1,detailPixels:0,rejectedPixels:0,consideredPixels:0};
  const gain=(QUALITY_GAIN[quality]??QUALITY_GAIN.high)*(MATERIAL_DETAIL_GAIN[material]??1);
  if(gain<=0)return {image:base,agreement:1,confidence:1,detailPixels:0,rejectedPixels:0,consideredPixels:0};

  const out={width:base.width,height:base.height,data:new Uint8ClampedArray(base.data)};
  const impulseLimit=MATERIAL_LIMIT[material]??MATERIAL_LIMIT.generic;
  const profile=MATERIAL_PROFILE[material]??MATERIAL_PROFILE.generic;
  let agreementSum=0,confidenceSum=0,detailPixels=0,rejectedPixels=0,count=0;

  for(let y=0;y<base.height;y++){
    for(let x=0;x<base.width;x++){
      const i=(y*base.width+x)*4;
      if(base.data[i+3]<16)continue;
      const disagreement=(
        Math.abs(base.data[i]-detail.data[i])+
        Math.abs(base.data[i+1]-detail.data[i+1])+
        Math.abs(base.data[i+2]-detail.data[i+2])
      )/3;
      const colourAgreement=clamp01(1-disagreement/72);
      const structure=structureConfidence(base,detail,x,y);
      let baseEnergy=0,detailEnergy=0;
      for(let c=0;c<3;c++){
        baseEnergy+=Math.abs(residualAt(base,x,y,c));
        detailEnergy+=Math.abs(residualAt(detail,x,y,c));
      }
      baseEnergy/=3;detailEnergy/=3;
      const modelOnly=clamp01((detailEnergy-baseEnergy-2)/18);
      const baseSupport=clamp01((baseEnergy-1)/12);
      const modelOnlySafety=1-modelOnly*(1-profile.modelOnlyAllowance)*(1-baseSupport);
      const confidence=clamp01(colourAgreement*(.25+.75*structure)*modelOnlySafety);
      agreementSum+=colourAgreement;
      confidenceSum+=confidence;
      count++;
      if(confidence<profile.minConfidence || (structure<.10 && confidence<profile.minConfidence+.08)){
        rejectedPixels++;continue;
      }

      let used=false;
      for(let c=0;c<3;c++){
        const detailResidual=residualAt(detail,x,y,c);
        const baseResidual=residualAt(base,x,y,c);
        if(Math.abs(detailResidual)<1.5)continue;
        const detailDelta=detailResidual-baseResidual;
        if(Math.abs(detailDelta)<1)continue;
        const residualAgreement=clamp01(1-Math.abs(detailDelta)/
          Math.max(8,Math.abs(detailResidual)+Math.abs(baseResidual)));
        // Inject only the extra detail contributed by the fidelity CNN. If both CNNs already
        // contain the same structure, detailDelta is zero and the base result stays untouched.
        const noveltyGate=(.20+.80*residualAgreement)*profile.noveltyScale;
        const supported=detailDelta*noveltyGate*modelOnlySafety;
        const limited=Math.max(-impulseLimit,Math.min(impulseLimit,supported));
        out.data[i+c]=clamp8(base.data[i+c]+limited*gain*confidence);
        used=true;
      }
      if(used)detailPixels++;
    }
  }
  return {
    image:out,
    agreement:count?agreementSum/count:1,
    confidence:count?confidenceSum/count:1,
    detailPixels,
    rejectedPixels,
    consideredPixels:count,
  };
}

export const CNN_FUSION_PROFILES=MATERIAL_PROFILE;
}
