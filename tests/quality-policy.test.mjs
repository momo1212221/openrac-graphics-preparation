import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QUALITY_POLICY_VERSION,QUALITY_TARGETS,chooseBetterQuality,evaluateQuality,highestPassingQuality,qualityTargetFor} from '../src/quality-policy.js';

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


test('highest passing tier respects the render tier cap',()=>{
  assert.equal(highestPassingQuality(safe(98),{textureClass:'diffuse',material:'stone'},'max'),'max');
  assert.equal(highestPassingQuality(safe(98),{textureClass:'diffuse',material:'stone'},'high'),'high');
  assert.equal(highestPassingQuality(safe(95),{textureClass:'diffuse',material:'stone'},'max'),'high');
  assert.equal(highestPassingQuality(safe(92),{textureClass:'diffuse',material:'stone'},'high'),'standard');
  assert.equal(highestPassingQuality(safe(89),{textureClass:'diffuse',material:'stone'},'max'),null);
  assert.equal(QUALITY_POLICY_VERSION,'90-94-97-v2');
});


test('material risk profile tightens fragile surfaces without lowering tier score',()=>{
  const maxGeneric=qualityTargetFor('max','generic','diffuse');
  const maxGlass=qualityTargetFor('max','glass','diffuse');
  const maxStone=qualityTargetFor('max','stone','diffuse');
  assert.equal(maxGeneric.score,97);
  assert.equal(maxGlass.score,97);
  assert.equal(maxStone.score,97);
  assert.ok(maxGlass.cnnConfidence>maxGeneric.cnnConfidence);
  assert.ok(maxGlass.cnnRejectedRatio<maxGeneric.cnnRejectedRatio);
  assert.ok(maxGlass.hallucination<maxGeneric.hallucination);
  assert.ok(maxStone.cnnConfidence<maxGeneric.cnnConfidence);
  assert.ok(maxStone.cnnRejectedRatio>maxGeneric.cnnRejectedRatio);
});

test('same CNN metrics can pass stone but retry glass at the same tier',()=>{
  const metrics=safe(97,{
    cnnConfidence:.70,cnnRejectedRatio:.20,ssim:.90,hallucinationScore:12,edgeGain:1.7,
  });
  const stone=evaluateQuality(metrics,{detailQuality:'max',textureClass:'diffuse',material:'stone'});
  const glass=evaluateQuality(metrics,{detailQuality:'max',textureClass:'diffuse',material:'glass'});
  assert.equal(stone.verdict,'pass');
  assert.equal(glass.verdict,'retry');
  assert.ok(glass.reasons.includes('low CNN confidence')||glass.reasons.includes('high CNN rejection'));
});

test('near-equal recovery with much better CNN confidence is preferred',()=>{
  const primary={metrics:{score:96,hallucinationScore:22,ssim:.88,cnnConfidence:.48,cnnRejectedRatio:.52}};
  const safer={metrics:{score:94.5,hallucinationScore:20,ssim:.89,cnnConfidence:.72,cnnRejectedRatio:.18}};
  assert.equal(chooseBetterQuality(primary,safer),safer);
});
