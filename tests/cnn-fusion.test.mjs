import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fuseCnnOutputs} from '../src/cnn-fusion.js';
const img=(w,h,v)=>({width:w,height:h,data:new Uint8ClampedArray(Array(w*h).fill(0).flatMap(()=>[v,v,v,255]))});
test('identical CNN outputs are stable',()=>{
  const a=img(3,3,100),b=img(3,3,100);
  const out=fuseCnnOutputs(a,b,{quality:'max',material:'stone'});
  assert.deepEqual([...out.image.data],[...a.data]);assert.equal(out.agreement,1);
});
test('strong disagreement suppresses hallucinated detail',()=>{
  const a=img(3,3,100),b=img(3,3,240);
  b.data.set([0,0,0,255],16);
  const out=fuseCnnOutputs(a,b,{quality:'max',material:'stone'});
  assert.ok(out.agreement<0.2);
  assert.ok(Math.abs(out.image.data[16]-100)<20);
});


test('structure disagreement is gated even when RGB values are close',()=>{
  const a=img(5,5,100),b=img(5,5,100);
  a.data.set([132,132,132,255],(2*5+2)*4);
  b.data.set([132,132,132,255],(2*5+1)*4);
  const out=fuseCnnOutputs(a,b,{quality:'max',material:'stone'});
  assert.ok(out.confidence<out.agreement);
  assert.ok(out.rejectedPixels>0);
});

test('material impulse caps keep glass more conservative than stone',()=>{
  const base=img(5,5,100),detail=img(5,5,100);
  detail.data.set([180,180,180,255],(2*5+2)*4);
  const stone=fuseCnnOutputs(base,detail,{quality:'max',material:'stone'}).image.data[(2*5+2)*4];
  const glass=fuseCnnOutputs(base,detail,{quality:'max',material:'glass'}).image.data[(2*5+2)*4];
  assert.ok(stone>=glass);
});
