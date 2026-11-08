import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildFrequencyBands,applyFrequencyBands} from '../src/frequency-reconstruct.js';
import {detectOutputFailures} from '../src/failure-detect.js';

const img=(w,h,v)=>{const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<w*h;i++)data.set([v,v,v,255],i*4);return {width:w,height:h,data}};

test('frequency bands preserve flat regions and reconstruct local structure',()=>{
  const src=img(5,5,100);
  src.data.set([170,140,110,255],(2*5+2)*4);
  const bands=buildFrequencyBands(src);
  const out=img(20,20,100);
  applyFrequencyBands(bands,out,{fine:.5,mid:.2,coarse:.1});
  assert.ok(out.data.some((v,i)=>i%4!==3&&v!==100));
  const flat=buildFrequencyBands(img(4,4,80));
  assert.ok([...flat.fine].every(v=>v===0));
});

test('failure detector catches catastrophic and excessive outputs',()=>{
  const src=img(2,2,100),bad=img(8,8,0);
  const r=detectOutputFailures(src,bad,{edgeGain:4,alphaDrift:0,cnnAgreement:.1,hallucinationScore:80,seamScore:40});
  assert.equal(r.ok,false);
  assert.ok(r.issues.includes('black-output'));
  assert.ok(r.issues.includes('over-detail'));
  assert.ok(r.issues.includes('hallucination-risk'));
});
