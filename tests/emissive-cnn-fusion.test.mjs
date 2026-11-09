// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {fuseEmissivePrediction, EMISSIVE_CNN_FUSION_VERSION} from '../src/emissive-cnn-fusion.js';

function makeImage(pixels, width = pixels.length) {
  const height = pixels.length / width;
  return {width,height,data:Uint8ClampedArray.from(pixels.flat())};
}
function probabilities(...values) { return {width:values.length,height:1,probabilities:Float32Array.from(values)}; }
const zero = (source) => ({width:source.width,height:source.height,data:new Uint8ClampedArray(source.data.length)});

test('contract version and no-CNN fallback retain exact heuristic output', () => {
  const source=makeImage([[240,180,10,255]]), base=makeImage([[1,2,3,255]]);
  const result=fuseEmissivePrediction({source,heuristic:base});
  assert.equal(EMISSIVE_CNN_FUSION_VERSION,1);
  assert.equal(result.report.status,'no-prediction');
  assert.deepEqual([...result.emissive.data],[1,2,3,255]);
  assert.notEqual(result.emissive.data,base.data);
});

test('bright white lamp with strong CNN confidence is promoted without hue shift', () => {
  const source=makeImage([[255,247,226,255]]);
  const result=fuseEmissivePrediction({source,heuristic:zero(source),prediction:probabilities(0.999),material:'metal'});
  assert.equal(result.report.promotedPixels,1);
  assert.ok(result.emissive.data[0]>220);
  assert.ok(result.emissive.data[0]>=result.emissive.data[1]);
  assert.ok(result.emissive.data[1]>=result.emissive.data[2]);
});

test('dark pixel cannot turn into bright emissive output even when CNN is confident', () => {
  const source=makeImage([[15,10,5,255]]);
  const result=fuseEmissivePrediction({source,heuristic:zero(source),prediction:probabilities(1),material:'metal'});
  assert.equal(result.report.brightRejectedPixels,1);
  assert.equal(result.emissivePixels,0);
});

test('saturated green leaves are blocked on ordinary materials', () => {
  const source=makeImage([[20,245,24,255]]);
  const result=fuseEmissivePrediction({source,heuristic:zero(source),prediction:probabilities(1),material:'organic'});
  assert.equal(result.emissivePixels,0);
  assert.equal(result.report.greenRejectedPixels,1);
});

test('explicit energy materials can contain green emitters', () => {
  const source=makeImage([[15,245,55,255]]);
  const result=fuseEmissivePrediction({source,heuristic:zero(source),prediction:probabilities(1),material:'energy'});
  assert.equal(result.emissivePixels,1);
});

test('explicitly approved green LED is allowed', () => {
  const source=makeImage([[15,245,55,255]]);
  const result=fuseEmissivePrediction({source,heuristic:zero(source),prediction:probabilities(1),material:'metal',allowGreenEmission:true});
  assert.equal(result.emissivePixels,1);
});

test('transparent pixels are protected from a predicted emission', () => {
  const source=makeImage([[255,255,255,0]]);
  const base=zero(source);
  base.data[0]=10;
  const result=fuseEmissivePrediction({source,heuristic:base,prediction:probabilities(1)});
  assert.deepEqual([...result.emissive.data],[0,0,0,0]);
  assert.equal(result.report.transparentPixels,1);
});

test('invalid/NaN and wrong-shape mask cannot mutate the existing emissive map', () => {
  const source=makeImage([[200,210,220,255],[120,100,80,255]]);
  const base=makeImage([[55,66,77,255],[1,2,3,255]]);
  for(const mask of [probabilities(Number.NaN), probabilities(0.5),
                      {width:2,height:1,probabilities:Float32Array.from([1,Infinity])},
                      {width:2,height:1,probabilities:Float32Array.from([1,-0.01])}]) {
    const result=fuseEmissivePrediction({source,heuristic:base,prediction:mask});
    assert.equal(result.report.status,'invalid-prediction');
    assert.deepEqual([...result.emissive.data],[...base.data]);
  }
});

test('verification mode suppresses low-confidence rule false positives only when explicitly enabled', () => {
  const source=makeImage([[20,240,20,255]]), base=makeImage([[30,50,40,255]]);
  const prediction=probabilities(0.02);
  const augmented=fuseEmissivePrediction({source,heuristic:base,prediction,material:'terrain'});
  const verified=fuseEmissivePrediction({source,heuristic:base,prediction,material:'terrain',mode:'verify'});
  assert.equal(augmented.emissivePixels,1);
  assert.equal(verified.emissivePixels,0);
  assert.equal(verified.report.suppressedPixels,1);
  assert.equal(base.data[1],50);
});

test('verify mode does not erase existing authored energy emission', () => {
  const source=makeImage([[220,180,55,255]]), base=makeImage([[90,70,20,255]]);
  const result=fuseEmissivePrediction({source,heuristic:base,prediction:probabilities(0),material:'energy',mode:'verify'});
  assert.equal(result.emissivePixels,1);
  assert.deepEqual([...result.emissive.data],[...base.data]);
});

test('thresholds, hashes and mismatched image size have explicit contracts', () => {
  const source=makeImage([[240,200,120,255]]);
  assert.throws(()=>fuseEmissivePrediction({source,heuristic:zero(source),confidence:1}),RangeError);
  assert.throws(()=>fuseEmissivePrediction({source,heuristic:zero(source),mode:'force'}),RangeError);
  assert.throws(()=>fuseEmissivePrediction({source,heuristic:zero(source),modelSha256:'bad'}),TypeError);
  const wrong=makeImage([[255,255,255,255],[255,255,255,255]]);
  assert.throws(()=>fuseEmissivePrediction({source,heuristic:wrong}),RangeError);
});

test('pixel alignment and source ownership are preserved across a 2D image', () => {
  const source=makeImage([[0,0,0,255],[255,255,255,255],[20,20,20,255],[220,180,150,255]],2);
  const base=zero(source);
  const prediction={width:2,height:2,probabilities:Float32Array.from([1,0.2,0.1,1])};
  const result=fuseEmissivePrediction({source,heuristic:base,prediction,material:'metal'});
  assert.equal(result.report.promotedPixels,1);
  assert.equal(result.emissive.data[0],0);
  assert.equal(result.emissive.data[4],0);
  assert.equal(result.emissive.data[8],0);
  assert.ok(result.emissive.data[12]>0);
  assert.equal(base.data[12],0);
});
