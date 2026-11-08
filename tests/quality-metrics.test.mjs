import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lockSourceChroma,qualityMetrics} from '../src/quality-metrics.js';
const image=(w,h,r,g,b)=>{const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++)data.set([r,g,b,255],i*4);return {width:w,height:h,data}};
test('source chroma lock changes colour without flattening output luma',()=>{
  const src=image(1,1,200,40,30),out=image(4,4,40,160,210);
  const before=out.data[0]+out.data[1]+out.data[2];
  lockSourceChroma(src,out,.8);
  assert.ok(out.data[0]>40);
  assert.ok(Math.abs((out.data[0]+out.data[1]+out.data[2])-before)<120);
});
test('quality score rewards faithful colour and CNN agreement',()=>{
  const src=image(2,2,100,80,60),good=image(8,8,100,80,60),bad=image(8,8,20,220,240);
  assert.ok(qualityMetrics(src,good,{cnnAgreement:1}).score>qualityMetrics(src,bad,{cnnAgreement:.2}).score);
});
