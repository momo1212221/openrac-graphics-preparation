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
