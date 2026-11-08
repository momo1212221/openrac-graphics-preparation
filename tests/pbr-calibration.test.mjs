import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calibratePbrMaps,PBR_PROFILES,validatePbrCalibration} from '../src/pbr-calibration.js';

const map=(w,h,value,alpha=255)=>{
  const data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++)data.set([value,value,value,alpha],i*4);
  return {width:w,height:h,data};
};
const source=(w,h,r=120,g=120,b=120)=>{
  const data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++)data.set([r,g,b,255],i*4);
  return {width:w,height:h,data};
};
const maps=(w=4,h=4)=>({
  roughness:map(w,h,20),metallic:map(w,h,220),specular:map(w,h,240),
  cavity:map(w,h,20),edgewear:map(w,h,10),emissive:map(w,h,0),
});

test('stone calibration suppresses dielectric metallic leakage',()=>{
  const m=maps();
  const result=calibratePbrMaps(m,source(4,4),'stone');
  assert.ok(result.meanMetallic<=PBR_PROFILES.stone.metallic[1]);
  assert.ok(result.meanRoughness>=PBR_PROFILES.stone.roughness[0]);
  assert.equal(validatePbrCalibration(result).ok,true);
});

test('metal calibration keeps a conductive metallic workflow',()=>{
  const m=maps();
  m.metallic=map(4,4,80);
  const result=calibratePbrMaps(m,source(4,4,110,112,115),'metal');
  assert.ok(result.meanMetallic>=PBR_PROFILES.metal.metallic[0]);
  assert.ok(result.meanSpecular>=PBR_PROFILES.metal.specular[0]);
  assert.equal(validatePbrCalibration(result).ok,true);
});

test('weapon profile remains hybrid instead of forcing all pixels to metal',()=>{
  const m=maps();
  m.metallic=map(4,4,100);
  const neutral=calibratePbrMaps(m,source(4,4,120,120,125),'weapon');
  assert.ok(neutral.meanMetallic>PBR_PROFILES.weapon.metallic[0]);
  assert.ok(neutral.meanMetallic<PBR_PROFILES.weapon.metallic[1]);
});

test('fabric stays rough and dielectric',()=>{
  const m=maps();
  const result=calibratePbrMaps(m,source(4,4,90,50,40),'fabric');
  assert.ok(result.meanRoughness>=PBR_PROFILES.fabric.roughness[0]);
  assert.ok(result.meanMetallic<=PBR_PROFILES.fabric.metallic[1]);
  assert.equal(validatePbrCalibration(result).ok,true);
});
