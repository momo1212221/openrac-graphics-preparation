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
test('fusion reports how much local CNN detail was rejected',()=>{
  const a=img(3,3,100),b=img(3,3,240);
  b.data.set([0,0,0,255],16);
  const out=fuseCnnOutputs(a,b,{quality:'max',material:'stone'});
  assert.equal(out.consideredPixels,9);
  assert.ok(out.rejectedPixels>0);
  assert.ok(out.rejectedPixels/out.consideredPixels>0);
});


test('identical structured CNN outputs are not sharpened twice',()=>{
  const base=img(5,5,100);
  base.data.set([150,150,150,255],(2*5+2)*4);
  const detail={width:base.width,height:base.height,data:new Uint8ClampedArray(base.data)};
  for(const material of ['stone','metal','character','glass']){
    const out=fuseCnnOutputs(base,detail,{quality:'max',material});
    assert.deepEqual([...out.image.data],[...base.data],material);
    assert.equal(out.detailPixels,0,material);
  }
});


test('flat model-only microtexture is more strongly suppressed on fragile materials',()=>{
  const base=img(9,9,100),detail=img(9,9,100);
  for(let y=0;y<9;y++)for(let x=0;x<9;x++){
    const i=(y*9+x)*4;
    const d=(x+y)%2===0?12:-12;
    detail.data[i]=detail.data[i+1]=detail.data[i+2]=100+d;
  }
  const stone=fuseCnnOutputs(base,detail,{quality:'max',material:'stone'});
  const glass=fuseCnnOutputs(base,detail,{quality:'max',material:'glass'});
  const character=fuseCnnOutputs(base,detail,{quality:'max',material:'character'});
  const maxDelta=(out)=>Math.max(...Array.from({length:81},(_,p)=>Math.abs(out.image.data[p*4]-100)));
  assert.ok(maxDelta(glass)<=maxDelta(stone));
  assert.ok(maxDelta(character)<=maxDelta(stone));
  assert.ok(glass.confidence<=stone.confidence);
  assert.ok(character.confidence<=stone.confidence);
});

test('real base structure still allows conservative detail refinement',()=>{
  const base=img(7,7,100),detail=img(7,7,100);
  const c=(3*7+3)*4;
  base.data.set([128,128,128,255],c);
  detail.data.set([142,142,142,255],c);
  const stone=fuseCnnOutputs(base,detail,{quality:'max',material:'stone'});
  assert.ok(stone.detailPixels>0);
  assert.ok(stone.image.data[c]>=base.data[c]);
  assert.ok(stone.image.data[c]-base.data[c]<20);
});
