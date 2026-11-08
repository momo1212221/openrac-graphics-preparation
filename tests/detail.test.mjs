import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DETAIL_QUALITY,PROFILE,restoreSourceDetail} from '../src/detail.js';

const image=(w,h,rgb)=>{
  const data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++)data.set([...rgb,255],i*4);
  return {width:w,height:h,data};
};

test('High/Max add structure while reducing old output sharpening',()=>{
  assert.equal(DETAIL_QUALITY.standard.sharpenScale,1);
  assert.equal(DETAIL_QUALITY.high.sharpenScale,0.35);
  assert.equal(DETAIL_QUALITY.max.sharpenScale,0);
  assert.ok(DETAIL_QUALITY.max.fine>DETAIL_QUALITY.high.fine);
  assert.ok(DETAIL_QUALITY.max.mid>DETAIL_QUALITY.high.mid);
  assert.ok(DETAIL_QUALITY.max.coarse>DETAIL_QUALITY.high.coarse);
  assert.ok(DETAIL_QUALITY.high.fine>DETAIL_QUALITY.standard.fine);
});

test('base CNN profiles remain available',()=>{
  assert.deepEqual(PROFILE,{
    faithful:{residual:0.28,sharpen:0.04},
    balanced:{residual:0.44,sharpen:0.16},
    enhanced:{residual:0.56,sharpen:0.30},
  });
});

test('high detail restores source microstructure without requiring extra sharpen',()=>{
  const src=image(3,3,[100,100,100]);
  src.data.set([150,130,110,255],16);
  const out=image(12,12,[112,112,112]);
  const stats=restoreSourceDetail(src,out,'balanced',true,false,{detailQuality:'high',textureClass:'diffuse'});
  assert.ok(stats.microdetails>=1);
  assert.equal(stats.detailQuality,'high');
});

test('normal maps do not receive colour residual reconstruction',()=>{
  const src=image(3,3,[128,128,255]);
  const out=image(12,12,[128,128,255]);
  const before=[...out.data];
  const stats=restoreSourceDetail(src,out,'balanced',true,false,{detailQuality:'max',textureClass:'normal'});
  assert.equal(stats.microdetails,0);
  assert.deepEqual([...out.data],before);
});
