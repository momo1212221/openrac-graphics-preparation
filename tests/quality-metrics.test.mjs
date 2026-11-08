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

test('extended metrics expose structural histogram alpha and hallucination signals',()=>{
  const src=image(3,3,100,90,80),good=image(12,12,100,90,80),bad=image(12,12,250,10,240);
  const a=qualityMetrics(src,good,{cnnAgreement:1});
  const b=qualityMetrics(src,bad,{cnnAgreement:.1});
  assert.ok(a.ssim>b.ssim);
  assert.ok(b.histogramDrift>=a.histogramDrift);
  assert.ok(b.hallucinationScore>a.hallucinationScore);
  assert.equal(a.alphaCoverageDiff,0);
  assert.ok('seamScore' in a);
});


test('CNN confidence and rejection ratio raise hallucination risk',()=>{
  const src=image(2,2,100,90,80),out=image(8,8,100,90,80);
  const trusted=qualityMetrics(src,out,{cnnAgreement:.9,cnnConfidence:.9,cnnRejectedRatio:.05});
  const suspect=qualityMetrics(src,out,{cnnAgreement:.9,cnnConfidence:.2,cnnRejectedRatio:.8});
  assert.ok(suspect.hallucinationScore>trusted.hallucinationScore);
  assert.ok(suspect.score<trusted.score);
  assert.equal(suspect.cnnConfidence,.2);
  assert.equal(suspect.cnnRejectedRatio,.8);
});


test('structural CNN confidence contributes to hallucination risk',()=>{
  const src=image(2,2,100,100,100),out=image(8,8,100,100,100);
  const high=qualityMetrics(src,out,{cnnAgreement:.9,cnnConfidence:.9});
  const low=qualityMetrics(src,out,{cnnAgreement:.9,cnnConfidence:.1});
  assert.ok(low.hallucinationScore>high.hallucinationScore);
  assert.ok(low.score<high.score);
  assert.equal(low.cnnConfidence,.1);
});


test('PSNR is maximal for identical output and drops with error',()=>{
 const src=image(2,2,100,90,80),same=image(8,8,100,90,80),bad=image(8,8,150,40,180);
 const a=qualityMetrics(src,same),b=qualityMetrics(src,bad);
 assert.equal(a.psnr,99);
 assert.ok(b.psnr<a.psnr);
 assert.ok(Number.isFinite(b.psnr));
});
