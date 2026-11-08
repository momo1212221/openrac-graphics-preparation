import {test} from 'node:test';
import assert from 'node:assert/strict';
import {automaticDetailQuality,refinedDetailQuality} from '../src/quality-planner.js';

const metrics=(score,extra={})=>({
  score,cnnAgreement:.9,cnnConfidence:.85,colorDrift:4,edgeGain:1.2,ssim:.94,
  alphaCoverageDiff:0,hallucinationScore:8,cnnRejectedRatio:.05,cnnLowConfidenceRatio:.05,cnnConfidenceP10:.5,...extra,
});

test('automatic planner reserves max detail for important assets',()=>{
  assert.equal(automaticDetailQuality({path:'Characters/Ratchet/body.png',size:200000},'auto'),'max');
  assert.equal(automaticDetailQuality({path:'Interface/font.png',size:200000},'auto'),'standard');
  assert.equal(automaticDetailQuality({path:'World/terrain/rock.png',size:200000},'auto'),'high');
});

test('global explicit quality bypasses automatic planning',()=>{
  assert.equal(automaticDetailQuality({path:'Characters/Ratchet/body.png',size:200000},'standard'),'standard');
});

test('90 is standard, 94 sustains high, and 97 can promote max',()=>{
  assert.equal(refinedDetailQuality({textureClass:'diffuse',material:'weapon',metrics:metrics(89)},'high'),'standard');
  assert.equal(refinedDetailQuality({textureClass:'diffuse',material:'weapon',metrics:metrics(94)},'high'),'high');
  assert.equal(refinedDetailQuality({textureClass:'diffuse',material:'weapon',metrics:metrics(98)},'high'),'max');
});

test('max tier demotes to high until it reaches 97',()=>{
  assert.equal(refinedDetailQuality({textureClass:'diffuse',material:'stone',metrics:metrics(95)},'max'),'high');
  assert.equal(refinedDetailQuality({textureClass:'diffuse',material:'stone',metrics:metrics(97)},'max'),'max');
});

test('structural and hallucination risk blocks aggressive detail',()=>{
  const base={textureClass:'diffuse',material:'weapon',metrics:metrics(98)};
  assert.equal(refinedDetailQuality({...base,metrics:metrics(98,{hallucinationScore:40})},'max'),'standard');
  assert.equal(refinedDetailQuality({...base,metrics:metrics(98,{ssim:.70})},'high'),'standard');
  assert.equal(refinedDetailQuality({...base,metrics:metrics(98,{alphaCoverageDiff:3})},'high'),'standard');
});

test('high local rejection blocks max detail promotion',()=>{
  const result={textureClass:'diffuse',material:'weapon',metrics:metrics(98,{cnnRejectedRatio:.55})};
  assert.equal(refinedDetailQuality(result,'high'),'standard');
});


test('regional low confidence blocks max detail promotion',()=>{
  const lowArea={textureClass:'diffuse',material:'weapon',metrics:metrics(98,{cnnLowConfidenceRatio:.7})};
  const weakFloor={textureClass:'diffuse',material:'weapon',metrics:metrics(98,{cnnConfidenceP10:.05})};
  assert.equal(refinedDetailQuality(lowArea,'high'),'standard');
  assert.equal(refinedDetailQuality(weakFloor,'high'),'standard');
});
