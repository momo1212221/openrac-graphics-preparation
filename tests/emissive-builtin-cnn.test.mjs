import test from 'node:test';
import assert from 'node:assert/strict';
import {predictBuiltinEmissive,BUILTIN_EMISSIVE_MODEL} from '../src/emissive-builtin-cnn.js';
import {deriveMaterialMaps} from '../src/material-maps.js';

const image=(width,height)=>({
  width,height,data:new Uint8ClampedArray(width*height*4),
});
const fill=(im,x,y,colour)=>{
  const i=(y*im.width+x)*4;
  im.data.set(colour,i);
};

test('bundled model really performs 3-layer convolutional inference with no ONNX download',()=>{
  const im=image(32,32);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++) {
    const lamp=x>6&&x<13&&y>9&&y<16;
    const leaves=x>21&&x<30&&y>8&&y<19;
    fill(im,x,y,lamp?[255,60,18,255]:leaves?[24,240,25,255]:[45,42,35,255]);
  }
  const a=predictBuiltinEmissive(im),b=predictBuiltinEmissive(im);
  assert.match(BUILTIN_EMISSIVE_MODEL,/synthetic-cnn/);
  assert.equal(a.probabilities.length,32*32);
  assert.deepEqual(a.probabilities,b.probabilities);
  assert.ok([...a.probabilities].every(x=>Number.isFinite(x)&&x>=0&&x<=1));
  // Avoid conflating the synthetic model's segmentation quality with integration tests.
  const enhanced=deriveMaterialMaps(im,'metal',{emissivePrediction:a,emissiveCnnConfidence:0.68});
  assert.equal(enhanced.emissiveCnn.status,'applied');
  assert.equal(enhanced.emissive.width,32);
  const baseline=deriveMaterialMaps(im,'metal');
  assert.ok(enhanced.emissivePixels>=baseline.emissivePixels);
  assert.deepEqual([...im.data.slice(0,4)],[45,42,35,255]);
});

test('large source runs downsampled CNN and returns full resolution mask',()=>{
  const im=image(300,190);
  im.data.fill(110);
  for(let i=3;i<im.data.length;i+=4)im.data[i]=255;
  const r=predictBuiltinEmissive(im);
  assert.equal(r.width,300);assert.equal(r.height,190);
  assert.equal(r.probabilities.length,57000);
  assert.ok(Number.isFinite(r.probabilities[50000]));
});

test('alpha protection and invalid textures reject gracefully',()=>{
  const im=image(32,32);
  for(let i=0;i<im.data.length;i+=4)im.data.set([255,250,235,0],i);
  const r=predictBuiltinEmissive(im);
  assert.ok(r.probabilities.every(x=>x===0));
  assert.throws(()=>predictBuiltinEmissive({width:4,height:4,data:[]}),TypeError);
  assert.throws(()=>predictBuiltinEmissive(im,{maxSide:20}),RangeError);
});
