// SPDX-License-Identifier: GPL-3.0-or-later
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const clamp8=(v)=>Math.max(0,Math.min(255,Math.round(v)));

export const PBR_PROFILES=Object.freeze({
  generic:Object.freeze({roughness:[.34,.88],metallic:[.00,.12],specular:[.16,.42],metalTarget:.03}),
  terrain:Object.freeze({roughness:[.58,.96],metallic:[.00,.04],specular:[.12,.30],metalTarget:.01}),
  stone:Object.freeze({roughness:[.52,.94],metallic:[.00,.035],specular:[.13,.30],metalTarget:.008}),
  metal:Object.freeze({roughness:[.16,.62],metallic:[.72,1.00],specular:[.52,.92],metalTarget:.90}),
  fabric:Object.freeze({roughness:[.68,.97],metallic:[.00,.025],specular:[.10,.25],metalTarget:.005}),
  organic:Object.freeze({roughness:[.44,.88],metallic:[.00,.025],specular:[.12,.32],metalTarget:.005}),
  character:Object.freeze({roughness:[.32,.84],metallic:[.00,.18],specular:[.14,.40],metalTarget:.04}),
  weapon:Object.freeze({roughness:[.20,.72],metallic:[.18,.88],specular:[.28,.82],metalTarget:.58}),
  energy:Object.freeze({roughness:[.12,.58],metallic:[.00,.22],specular:[.24,.72],metalTarget:.05}),
  glass:Object.freeze({roughness:[.04,.28],metallic:[.00,.02],specular:[.62,.98],metalTarget:0}),
  sky:Object.freeze({roughness:[.62,.96],metallic:[0,.01],specular:[.08,.24],metalTarget:0}),
});

const profileFor=(material)=>PBR_PROFILES[material]||PBR_PROFILES.generic;
const scalar=(map,i)=>map?.data?.[i]/255||0;
const setScalar=(map,i,value)=>{
  if(!map)return;
  const v=clamp8(value*255);
  map.data[i]=map.data[i+1]=map.data[i+2]=v;
};

function sourceStats(source,i){
  if(!source?.data)return {saturation:0,luma:.5};
  const r=source.data[i]/255,g=source.data[i+1]/255,b=source.data[i+2]/255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
  return {
    saturation:mx?((mx-mn)/mx):0,
    luma:(.2126*r+.7152*g+.0722*b),
  };
}

/**
 * Keeps derived PBR sidecars inside conservative, mutually compatible material ranges.
 * This does not invent a new material from colour alone: the material classifier provides the
 * family, while source colour/edge information only modulates a bounded prior.
 */
export function calibratePbrMaps(maps,source,material="generic"){
  const profile=profileFor(material);
  const total=maps?.roughness?.width*maps?.roughness?.height||0;
  let adjusted=0,metalSum=0,roughSum=0,specSum=0,visible=0;
  let dielectricMetalLeak=0,metalUnderTarget=0;

  for(let p=0;p<total;p++){
    const i=p*4;
    const alpha=maps.roughness.data[i+3];
    if(alpha<16)continue;
    visible++;
    const s=sourceStats(source,i);
    const cavity=scalar(maps.cavity,i);
    const edge=scalar(maps.edgewear,i);
    const emissive=Math.max(
      maps.emissive?.data?.[i]||0,
      maps.emissive?.data?.[i+1]||0,
      maps.emissive?.data?.[i+2]||0
    )/255;

    const beforeR=scalar(maps.roughness,i);
    const beforeM=scalar(maps.metallic,i);
    const beforeS=scalar(maps.specular,i);

    // Roughness follows the generated local structure but is clamped to the material family.
    // Cavities are slightly rougher; exposed edges can be slightly smoother on hard surfaces.
    let rough=beforeR+cavity*.055;
    if(["metal","weapon"].includes(material))rough-=edge*.035;
    rough=clamp(rough,profile.roughness[0],profile.roughness[1]);

    // Metallic is a workflow flag, not "shininess". Strongly dielectric families stay near zero.
    // Weapon is intentionally hybrid; neutral hard-surface regions may be more metallic.
    let metalTarget=profile.metalTarget;
    if(material==="weapon"){
      metalTarget+=clamp((.30-s.saturation)*.38,-.10,.12);
      metalTarget+=clamp((s.luma-.45)*.12,-.05,.05);
    }else if(material==="metal"){
      metalTarget+=clamp((.20-s.saturation)*.18,-.05,.04);
    }
    let metal=clamp(beforeM*.38+metalTarget*.62,profile.metallic[0],profile.metallic[1]);

    // Emission does not imply metal. For dedicated energy surfaces, keep metallic conservative.
    if(material==="energy"&&emissive>.08)metal=Math.min(metal,.10);

    // Specular intensity is constrained by material family and metallic state. Dielectrics remain
    // restrained; conductors/hybrid weapons can retain a stronger reflection response.
    const metalMix=clamp(
      (metal-profile.metallic[0])/Math.max(.001,profile.metallic[1]-profile.metallic[0]),
      0,1
    );
    const targetSpec=profile.specular[0]+(profile.specular[1]-profile.specular[0])*(.28+.55*metalMix);
    let spec=beforeS*.45+targetSpec*.55;
    if(emissive>.15)spec*=1-Math.min(.18,emissive*.12);
    spec=clamp(spec,profile.specular[0],profile.specular[1]);

    setScalar(maps.roughness,i,rough);
    setScalar(maps.metallic,i,metal);
    setScalar(maps.specular,i,spec);

    if(Math.abs(rough-beforeR)>.01||Math.abs(metal-beforeM)>.01||Math.abs(spec-beforeS)>.01)adjusted++;
    if(profile.metalTarget<.1&&metal>.15)dielectricMetalLeak++;
    if(material==="metal"&&metal<.68)metalUnderTarget++;
    roughSum+=rough;metalSum+=metal;specSum+=spec;
  }

  const denom=Math.max(1,visible);
  return {
    material,
    profile:{
      roughness:[...profile.roughness],
      metallic:[...profile.metallic],
      specular:[...profile.specular],
    },
    visiblePixels:visible,
    adjustedPixels:adjusted,
    adjustedRatio:Number((adjusted/denom).toFixed(4)),
    meanRoughness:Number((roughSum/denom).toFixed(4)),
    meanMetallic:Number((metalSum/denom).toFixed(4)),
    meanSpecular:Number((specSum/denom).toFixed(4)),
    dielectricMetalLeakRatio:Number((dielectricMetalLeak/denom).toFixed(4)),
    metalUnderTargetRatio:Number((metalUnderTarget/denom).toFixed(4)),
  };
}

export function validatePbrCalibration(calibration){
  if(!calibration)return {ok:false,issues:["missing-pbr-calibration"]};
  const issues=[];
  if(calibration.dielectricMetalLeakRatio>.02)issues.push("dielectric-metallic-leak");
  if(calibration.material==="metal"&&calibration.metalUnderTargetRatio>.05)issues.push("metallic-too-low");
  const p=profileFor(calibration.material);
  if(calibration.meanRoughness<p.roughness[0]-.01||calibration.meanRoughness>p.roughness[1]+.01)
    issues.push("roughness-out-of-profile");
  if(calibration.meanMetallic<p.metallic[0]-.01||calibration.meanMetallic>p.metallic[1]+.01)
    issues.push("metallic-out-of-profile");
  if(calibration.meanSpecular<p.specular[0]-.01||calibration.meanSpecular>p.specular[1]+.01)
    issues.push("specular-out-of-profile");
  return {ok:issues.length===0,issues};
}
