import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyMaterial,MATERIAL_DETAIL_GAIN} from '../src/material-classify.js';
const image=(rgb=[100,100,100,255])=>({width:4,height:4,data:new Uint8ClampedArray(Array(16).fill(rgb).flat())});
test('path hints route high-confidence materials',()=>{
  assert.equal(classifyMaterial(['Weapons/blaster/hash.png'],image(),'diffuse').material,'weapon');
  assert.equal(classifyMaterial(['Terrain/rock/hash.png'],image(),'diffuse').material,'terrain');
  assert.equal(classifyMaterial(['Interface/hash.png'],image(),'ui').material,'ui');
});
test('technical materials have zero generative detail gain',()=>{
  assert.equal(MATERIAL_DETAIL_GAIN.normal,0);assert.equal(MATERIAL_DETAIL_GAIN.mask,0);
  assert.ok(MATERIAL_DETAIL_GAIN.stone>MATERIAL_DETAIL_GAIN.generic);
});
