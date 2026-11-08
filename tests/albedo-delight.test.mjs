import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveAlbedoSidecar,validateAlbedoSidecar} from '../src/albedo-delight.js';

const image=(w,h,fn)=>{
  const data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(fn(x,y),(y*w+x)*4);
  return {width:w,height:h,data};
};

test('stone albedo sidecar reduces bounded low-frequency lighting bias',()=>{
  const src=image(32,16,(x)=>x<16?[70,65,60,255]:[150,140,130,255]);
  const result=deriveAlbedoSidecar(src,null,'stone');
  assert.ok(result.adjustedPixels>0);
  assert.ok(result.minCorrection>=.78);
  assert.ok(result.maxCorrection<=1.24);
  assert.equal(validateAlbedoSidecar(result).ok,true);
});

test('energy material is left unchanged by de-lighting',()=>{
  const src=image(8,8,()=>[240,70,20,255]);
  const result=deriveAlbedoSidecar(src,null,'energy');
  assert.equal(result.strength,0);
  assert.deepEqual([...result.image.data],[...src.data]);
});

test('emissive pixels are protected from strong correction',()=>{
  const src=image(16,8,(x)=>x<8?[45,35,30,255]:[210,80,30,255]);
  const emissive=image(16,8,(x)=>x>=8?[255,80,20,255]:[0,0,0,255]);
  const withProtection=deriveAlbedoSidecar(src,emissive,'stone');
  const i=(4*16+12)*4;
  assert.ok(Math.abs(withProtection.image.data[i]-src.data[i])<20);
});

test('alpha is preserved exactly',()=>{
  const src=image(8,8,(x,y)=>[100,90,80,(x+y)%2?255:64]);
  const result=deriveAlbedoSidecar(src,null,'terrain');
  for(let i=3;i<src.data.length;i+=4)assert.equal(result.image.data[i],src.data[i]);
});
