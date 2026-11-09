// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveMaterialMaps} from '../src/material-maps.js';

function fixture() {
  const width=8, height=8, data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    data.set(x<4?[255,249,224,255]:[20,245,24,255],i);
  }
  return {width,height,data};
}

test('unconfigured material CNN preserves existing emissive, albedo and normal bytes',()=>{
  const src=fixture();
  const baseline=deriveMaterialMaps(src,'organic');
  const noCnn=deriveMaterialMaps(src,'organic',{emissivePrediction:null});
  for(const name of ['emissive','albedo','normal','roughness','height','ao']) {
    assert.deepEqual([...noCnn[name].data],[...baseline[name].data],name);
  }
  assert.equal(noCnn.emissiveCnn,undefined);
});

test('optional CNN enhances a true bright emitter without making green leaves glow',()=>{
  const src=fixture();
  const before=deriveMaterialMaps(src,'organic');
  const prediction={width:src.width,height:src.height,
    probabilities:Float32Array.from({length:src.width*src.height},()=>1)};
  const result=deriveMaterialMaps(src,'organic',{emissivePrediction:prediction});
  assert.equal(result.emissiveCnn.status,'applied');
  assert.ok(result.emissiveCnn.promotedPixels>0);
  assert.ok(result.emissiveCnn.greenRejectedPixels>0);
  assert.ok(result.emissive.data[0]>before.emissive.data[0]);
  const foliage=(4*src.width+6)*4;
  assert.deepEqual([...result.emissive.data.slice(foliage,foliage+4)],
                   [...before.emissive.data.slice(foliage,foliage+4)]);
  assert.equal(result.emissive.data[3],255);
});

test('bad CNN prediction fails closed and retains historical emissive bytes',()=>{
  const src=fixture();
  const baseline=deriveMaterialMaps(src,'organic');
  const result=deriveMaterialMaps(src,'organic',{
    emissivePrediction:{width:1,height:1,probabilities:Float32Array.from([NaN])},
  });
  assert.equal(result.emissiveCnn.status,'invalid-prediction');
  assert.deepEqual([...result.emissive.data],[...baseline.emissive.data]);
});
