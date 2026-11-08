import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QUALITY_TARGETS,chooseBetterQuality,evaluateQuality,qualityTargetFor} from '../src/quality-policy.js';

const safe=(score,extra={})=>({
  score,colorDrift:4,lumaDrift:5,alphaDrift:0,alphaCoverageDiff:0,
  cnnAgreement:.9,cnnConfidence:.85,cnnRejectedRatio:.05,edgeGain:1.2,
  ssim:.94,hallucinationScore:8,...extra,
});

test('90 is the minimum standard quality score',()=>{
  const below=evaluateQuality(safe(89),{detailQuality:'standard',textureClass:'diffuse',material:'generic'});
  assert.equal(below.verdict,'retry');
  assert.equal(below.minimumMet,false);
  assert.equal(below.targetScore,90);

  const pass=evaluateQuality(safe(90),{detailQuality:'standard',textureClass:'diffuse',material:'generic'});
  assert.equal(pass.verdict,'pass');
  assert.equal(pass.minimumMet,true);
});

test('high and max tiers require 94 and 97 respectively',()=>{
  assert.equal(evaluateQuality(safe(93),{detailQuality:'high'}).verdict,'retry');
  assert.equal(evaluateQuality(safe(94),{detailQuality:'high'}).verdict,'pass');
  assert.equal(evaluateQuality(safe(96),{detailQuality:'max'}).verdict,'retry');
  assert.equal(evaluateQuality(safe(97),{detailQuality:'max'}).verdict,'pass');
  assert.equal(qualityTargetFor('standard').score,90);
  assert.equal(QUALITY_TARGETS.high.score,94);
  assert.equal(QUALITY_TARGETS.max.score,97);
});

test('catastrophic neural output is rejected even before tier recovery',()=>{
  const reject=evaluateQuality(safe(55,{colorDrift:30,cnnAgreement:.2,cnnConfidence:.1,edgeGain:4.2,hallucinationScore:80}),{
    textureClass:'diffuse',material:'weapon',detailQuality:'max'
  });
  assert.equal(reject.verdict,'reject');
  assert.equal(reject.fallback,true);
  assert.ok(reject.reasons.includes('low CNN agreement'));
});

test('a high score cannot hide a failed fidelity guard',()=>{
  const weak=evaluateQuality(safe(96,{ssim:.70}),{detailQuality:'high'});
  assert.equal(weak.verdict,'retry');
  assert.ok(weak.reasons.includes('low structural similarity'));
});

test('safer recovery wins when score is nearly equal',()=>{
  const primary={metrics:{score:96,hallucinationScore:58,ssim:.72}};
  const safer={metrics:{score:94.5,hallucinationScore:30,ssim:.84}};
  assert.equal(chooseBetterQuality(primary,safer),safer);
});
