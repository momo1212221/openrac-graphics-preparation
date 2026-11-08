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
