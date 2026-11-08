import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CORE, MODEL_INPUT, PAD, fixedRgbTile} from '../src/ai-tile.js';

function source(width,height) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    data[i]=x; data[i+1]=y; data[i+2]=x+y; data[i+3]=255;
  }
  return {width,height,data};
}

test('Real-ESRGAN tiles are always exactly 128x128 even for a 32x32 texture',()=>{
  const tile=fixedRgbTile(source(32,32),0,0);
  assert.equal(MODEL_INPUT,128);
  assert.equal(CORE,112);
  assert.equal(PAD,8);
  assert.equal(tile.length,3*128*128);
});

test('out-of-bounds tile padding clamps to the nearest real source pixel',()=>{
  const src=source(32,32);
  const tile=fixedRgbTile(src,0,0);
  const plane=128*128;
  assert.equal(tile[0],0);
  assert.equal(tile[plane],0);
  assert.equal(tile[plane*2],0);

  const last=fixedRgbTile(src,24,24);
  const p=127*128+127;
  assert.equal(Math.round(last[p]*255),31);
  assert.equal(Math.round(last[plane+p]*255),31);
  assert.equal(Math.round(last[plane*2+p]*255),62);
});
