import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textureComplexity,trivialTexture} from '../src/ai-analyze.js';

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


test('texture complexity separates smooth fields from edge-rich content',()=>{
  const smooth=new Uint8ClampedArray(16*16*4);
  for(let i=0;i<smooth.length;i+=4)smooth.set([100,100,100,255],i);
  const detailed=new Uint8ClampedArray(16*16*4);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const v=(x+y)%2?240:20,i=(y*16+x)*4;
    detailed.set([v,255-v,(x%3)*80,255],i);
  }
  const a=textureComplexity({width:16,height:16,data:smooth});
  const b=textureComplexity({width:16,height:16,data:detailed});
  assert.equal(a,0);
  assert.ok(b>.6);
});
