import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseBetterQuality,evaluateQuality} from '../src/quality-policy.js';

test('adaptive quality policy retries weak neural output and rejects critical output',()=>{
  const retry=evaluateQuality({score:43,colorDrift:10,lumaDrift:8,alphaDrift:0,cnnAgreement:.7,edgeGain:1.2},{textureClass:'diffuse',material:'generic',detailQuality:'max'});
  assert.equal(retry.verdict,'retry');
  assert.equal(retry.retry,true);
  const reject=evaluateQuality({score:20,colorDrift:30,lumaDrift:25,alphaDrift:0,cnnAgreement:.2,edgeGain:4},{textureClass:'diffuse',material:'weapon',detailQuality:'max'});
  assert.equal(reject.verdict,'reject');
  assert.equal(reject.fallback,true);
  assert.ok(reject.reasons.includes('low CNN agreement'));
});

test('UI is judged more conservatively and better recovery must win by more than noise',()=>{
  const ui=evaluateQuality({score:43,colorDrift:5,lumaDrift:5,alphaDrift:0,cnnAgreement:.9,edgeGain:1},{textureClass:'ui',material:'ui',detailQuality:'standard'});
  assert.equal(ui.verdict,'watch');
  const a={metrics:{score:60}},b={metrics:{score:60.5}},c={metrics:{score:62}};
  assert.equal(chooseBetterQuality(a,b),a);
  assert.equal(chooseBetterQuality(a,c),c);
});

test('safer recovery wins when score is nearly equal',()=>{
  const primary={metrics:{score:76,hallucinationScore:58,ssim:.72}};
  const safer={metrics:{score:74.5,hallucinationScore:30,ssim:.84}};
  assert.equal(chooseBetterQuality(primary,safer),safer);
});


test('fragile materials retry low-confidence CNN enrichment before obvious score failure',()=>{
  const glass=evaluateQuality({
    score:78,colorDrift:4,lumaDrift:4,alphaDrift:0,cnnAgreement:.8,
    cnnConfidence:.36,cnnRejectedRatio:.30,edgeGain:1.2,histogramDrift:3,
    alphaCoverageDiff:0,ssim:.82,hallucinationScore:25,psnr:28,
  },{textureClass:'diffuse',material:'glass',detailQuality:'max'});
  assert.equal(glass.verdict,'retry');
  assert.ok(glass.reasons.includes('low CNN confidence'));

  const stone=evaluateQuality({
    score:78,colorDrift:4,lumaDrift:4,alphaDrift:0,cnnAgreement:.8,
    cnnConfidence:.36,cnnRejectedRatio:.30,edgeGain:1.2,histogramDrift:3,
    alphaCoverageDiff:0,ssim:.82,hallucinationScore:25,psnr:28,
  },{textureClass:'diffuse',material:'stone',detailQuality:'max'});
  assert.equal(stone.verdict,'pass');
});

test('critically uncertain CNN output falls back even if aggregate score looks acceptable',()=>{
  const result=evaluateQuality({
    score:72,colorDrift:4,lumaDrift:4,alphaDrift:0,cnnAgreement:.7,
    cnnConfidence:.08,cnnRejectedRatio:.96,edgeGain:1.1,histogramDrift:2,
    alphaCoverageDiff:0,ssim:.8,hallucinationScore:30,psnr:25,
  },{textureClass:'diffuse',material:'character',detailQuality:'max'});
  assert.equal(result.verdict,'reject');
  assert.equal(result.fallback,true);
});

test('recovery with clearly better confidence can win at near-equal score',()=>{
  const primary={metrics:{score:76,hallucinationScore:35,cnnConfidence:.42,cnnRejectedRatio:.55,ssim:.8}};
  const safer={metrics:{score:74.5,hallucinationScore:33,cnnConfidence:.70,cnnRejectedRatio:.20,ssim:.81}};
  assert.equal(chooseBetterQuality(primary,safer),safer);
});
