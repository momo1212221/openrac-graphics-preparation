import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alphaProfile,reconstructAlphaEdges} from '../src/alpha-reconstruct.js';

const image=(w,h,fn)=>{
  const data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(fn(x,y),(y*w+x)*4);
  return {width:w,height:h,data};
};

test('opaque textures remain fully opaque',()=>{
  const src=image(2,2,()=>[80,90,100,255]);
  const out=image(8,8,()=>[120,130,140,17]);
  const stats=reconstructAlphaEdges(src,out);
  assert.equal(stats.hasTransparency,false);
  assert.ok([...out.data].filter((_,i)=>i%4===3).every(a=>a===255));
  assert.equal(stats.coverageErrorPercent,0);
});

test('hard cutout reconstruction preserves alpha coverage',()=>{
  const src=image(2,2,(x)=>x===0?[180,80,30,255]:[0,0,0,0]);
  const out=image(8,8,()=>[100,100,100,255]);
  const profile=alphaProfile(src);
  const stats=reconstructAlphaEdges(src,out);
  assert.equal(profile.hardCutout,true);
  assert.ok(Math.abs(stats.coverageAfter-profile.coverage128)<=.08);
  assert.ok(stats.coverageErrorPercent<=8);
  assert.ok(stats.edgePixels>0);
});

test('soft alpha remains graded instead of becoming binary',()=>{
  const src=image(2,1,(x)=>x===0?[200,120,60,64]:[220,140,80,192]);
  const out=image(8,4,()=>[100,100,100,255]);
  const stats=reconstructAlphaEdges(src,out);
  assert.equal(stats.hardCutout,false);
  const alphas=[];
  for(let i=3;i<out.data.length;i+=4)alphas.push(out.data[i]);
  assert.ok(alphas.some(a=>a>64&&a<192));
});

test('low-alpha edge colours are dilated from visible neighbours',()=>{
  const src=image(2,1,(x)=>x===0?[255,40,20,255]:[0,0,0,0]);
  const out=image(8,4,(x)=>x<4?[240,30,20,255]:[0,0,0,255]);
  const stats=reconstructAlphaEdges(src,out);
  assert.ok(stats.colorDilatedPixels>0);
  const edge=(1*8+4)*4;
  if(out.data[edge+3]>0&&out.data[edge+3]<128)assert.ok(out.data[edge]>0);
});
