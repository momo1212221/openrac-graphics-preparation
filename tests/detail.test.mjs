import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PROFILE, restoreSourceDetail} from '../src/detail.js';

const image=(w,h,rgb)=>{
  const data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++) data.set([...rgb,255],i*4);
  return {width:w,height:h,data};
};

test('fork profile strengths are preserved',()=>{
  assert.deepEqual(PROFILE,{
    faithful:{residual:0.28,sharpen:0.04},
    balanced:{residual:0.44,sharpen:0.16},
    enhanced:{residual:0.56,sharpen:0.30},
  });
});

test('star restoration puts a bright source point back into 4x output',()=>{
  const src=image(3,3,[8,8,12]);
  src.data.set([240,235,220,255],16);
  const out=image(12,12,[12,12,18]);
  const stats=restoreSourceDetail(src,out,'faithful',false,true);
  assert.equal(stats.stars,1);
  const center=((6*12)+6)*4;
  assert.ok(out.data[center]>=220 || out.data[center+4]>=220 || out.data[center+12*4]>=220);
});

test('balanced mode restores microcontrast',()=>{
  const src=image(3,3,[100,100,100]);
  src.data.set([150,130,110,255],16);
  const out=image(12,12,[112,112,112]);
  const stats=restoreSourceDetail(src,out,'balanced',true,false);
  assert.ok(stats.microdetails>=1);
});
