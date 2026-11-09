// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {predictEmissiveProbabilities,EMISSIVE_ONNX_TILE,EMISSIVE_ONNX_CONTEXT} from '../src/emissive-onnx-adapter.js';

class Tensor {
  constructor(type,data,dims) { Object.assign(this,{type,data,dims}); }
}
const ort={Tensor};
function image(width,height,colour=[220,190,150,255]){
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<data.length;i+=4)data.set(colour,i);
  return {width,height,data};
}
function session(probability=.99) {
  let calls=0;
  const obj={inputNames:['input'],outputNames:['output'],
    async run(inputs){
      assert.deepEqual(inputs.input.dims,[1,3,128,128]);
      assert.equal(inputs.input.type,'float32');
      calls++;
      return {output:{dims:[1,1,128,128],data:Float32Array.from({length:128*128},()=>probability)}};
    },get calls(){return calls;}};
  return obj;
}

test('tile and context sizes are explicit',()=>{
  assert.equal(EMISSIVE_ONNX_TILE,128);
  assert.equal(EMISSIVE_ONNX_CONTEXT,16);
});

test('one 8x4 image uses one padded tile and valid output',async()=>{
  const s=session();
  const result=await predictEmissiveProbabilities({image:image(8,4),ort,session:s});
  assert.equal(s.calls,1);
  assert.equal(result.width,8);
  assert.equal(result.probabilities.length,32);
  assert.ok([...result.probabilities].every(p=>p>.98&&p<=1));
});

test('odd nonmultiple dimensions cover each pixel exactly once with bounded per-tile allocation',async()=>{
  const s=session(.65),progress=[];
  const result=await predictEmissiveProbabilities({image:image(197,97),ort,session:s,onProgress:x=>progress.push(x)});
  assert.equal(s.calls,6);
  assert.deepEqual(progress.at(-1),{done:6,total:6});
  assert.equal(result.probabilities.length,197*97);
  assert.ok(result.probabilities.every(x=>x>.64&&x<.66));
});

test('transparent texels are zero in output',async()=>{
  const src=image(2,1);
  src.data[3]=0;
  const mask=await predictEmissiveProbabilities({image:src,ort,session:session(1)});
  assert.deepEqual([...mask.probabilities],[0,1]);
});

test('logits are converted to probabilities when declared',async()=>{
  const mask=await predictEmissiveProbabilities({image:image(2,1),ort,session:session(0),outputEncoding:'logit'});
  assert.deepEqual([...mask.probabilities],[.5,.5]);
});

test('bad dimensions or corrupt predictions reject atomically',async()=>{
  const faulty=session();
  faulty.run=async()=>({output:{dims:[1,2,128,128],data:new Float32Array(2*128*128)}});
  await assert.rejects(()=>predictEmissiveProbabilities({image:image(2,2),ort,session:faulty}),/shape/);
  const nan=session();
  nan.run=async()=>({output:{dims:[1,1,128,128],data:Float32Array.from({length:128*128},()=>NaN)}});
  await assert.rejects(()=>predictEmissiveProbabilities({image:image(2,2),ort,session:nan}),/nonfinite/);
});

test('cancel prevents the first inference and does not retain model state',async()=>{
  const s=session();
  await assert.rejects(()=>predictEmissiveProbabilities({image:image(192,192),ort,session:s,shouldCancel:()=>true}),/cancelled/);
  assert.equal(s.calls,0);
});
