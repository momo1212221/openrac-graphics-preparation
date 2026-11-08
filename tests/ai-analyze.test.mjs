import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trivialTexture} from '../src/ai-analyze.js';

const image=(width,height,pixels)=>({width,height,data:new Uint8ClampedArray(pixels)});

test('fully transparent texture is a lossless trivial bypass',()=>{
  const out=trivialTexture(image(2,1,[20,30,40,0,200,4,8,0]));
  assert.deepEqual(out,{trivial:true,reason:'transparent'});
});

test('exactly uniform visible texture is a lossless trivial bypass',()=>{
  const out=trivialTexture(image(2,1,[10,20,30,255,10,20,30,255]));
  assert.deepEqual(out,{trivial:true,reason:'uniform'});
});

test('any visible colour variation keeps the texture on the AI path',()=>{
  const out=trivialTexture(image(2,1,[10,20,30,255,11,20,30,255]));
  assert.deepEqual(out,{trivial:false,reason:null});
});
