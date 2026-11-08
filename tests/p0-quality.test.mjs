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
  applyFrequencyBands(bands,out,{fine:.5,mid:.2,coarse:.1,broad:.05});
  assert.ok(out.data.some((v,i)=>i%4!==3&&v!==100));
  const flat=buildFrequencyBands(img(4,4,80));
  assert.ok([...flat.fine].every(v=>v===0));
  assert.ok([...flat.broad].every(v=>v===0));
  assert.equal(bands.broad.length,5*5*3);
});

test('failure detector catches catastrophic and excessive outputs',()=>{
  const src=img(2,2,100),bad=img(8,8,0);
  const r=detectOutputFailures(src,bad,{edgeGain:4,alphaDrift:0,cnnAgreement:.1,cnnRejectedRatio:.8,hallucinationScore:80,seamScore:40});
  assert.equal(r.ok,false);
  assert.ok(r.issues.includes('black-output'));
  assert.ok(r.issues.includes('over-detail'));
  assert.ok(r.issues.includes('hallucination-risk'));
  assert.ok(r.issues.includes('cnn-local-rejection'));
});


test('directional band stays quiet on flat fields and avoids cross-edge halo energy',()=>{
  const flat=img(6,6,90);
  const flatBands=buildFrequencyBands(flat);
  assert.ok([...flatBands.directional].every(v=>v===0));
  assert.ok([...flatBands.directionalWeight].every(v=>v===0));

  const edge=img(6,6,30);
  for(let y=0;y<6;y++)for(let x=3;x<6;x++){
    const i=(y*6+x)*4;edge.data[i]=edge.data[i+1]=edge.data[i+2]=220;
  }
  const bands=buildFrequencyBands(edge);
  const near=(2*6+2)*3;
  const fineEnergy=Math.abs(bands.fine[near])+Math.abs(bands.fine[near+1])+Math.abs(bands.fine[near+2]);
  const directionalEnergy=Math.abs(bands.directional[near])+Math.abs(bands.directional[near+1])+Math.abs(bands.directional[near+2]);
  assert.ok(bands.directionalWeight[2*6+2]>0);
  assert.ok(directionalEnergy<fineEnergy);
});

test('directional reconstruction contributes on edge-aligned texture variation',()=>{
  const src=img(7,7,100);
  for(let y=1;y<6;y++){
    const x=3,i=(y*7+x)*4;
    const v=y%2?170:80;
    src.data[i]=v;src.data[i+1]=v-10;src.data[i+2]=v-20;
  }
  const bands=buildFrequencyBands(src);
  assert.ok([...bands.directional].some(v=>Math.abs(v)>1));
  const base=img(28,28,100),before=[...base.data];
  applyFrequencyBands(bands,base,{fine:0,mid:0,coarse:0,broad:0,directional:.6});
  assert.ok(base.data.some((v,i)=>i%4!==3&&v!==before[i]));
});
