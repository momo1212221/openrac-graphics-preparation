import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_INPUT,TILE_QUALITY,blendTile,fillFixedRgbTile,fixedRgbTile,tileGeometry} from '../src/ai-tile.js';

function source(width,height){
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;data[i]=x;data[i+1]=y;data[i+2]=x+y;data[i+3]=255;
  }
  return {width,height,data};
}

test('quality modes keep fixed 128 input while increasing context',()=>{
  assert.equal(MODEL_INPUT,128);
  assert.deepEqual(TILE_QUALITY.standard,{name:'standard',pad:8,core:112,overlap:0,step:112});
  assert.deepEqual(TILE_QUALITY.high,{name:'high',pad:16,core:96,overlap:8,step:88});
  assert.deepEqual(TILE_QUALITY.max,{name:'max',pad:24,core:80,overlap:16,step:64});
  assert.equal(tileGeometry('max','ui').name,'standard');
  assert.equal(tileGeometry('max','diffuse').name,'max');
});

test('fixed tile supports larger context without changing tensor dimensions',()=>{
  const tile=fixedRgbTile(source(32,32),0,0,24);
  assert.equal(tile.length,3*128*128);
});

test('tile builder reuses caller buffer',()=>{
  const src=source(16,16);
  const buffer=new Float32Array(3*MODEL_INPUT*MODEL_INPUT);
  assert.equal(fillFixedRgbTile(src,0,0,buffer,16),buffer);
});

test('overlap blending averages competing tile pixels instead of hard overwrite',()=>{
  const output=new ImageData(4,1);
  const weights=new Uint16Array(4);
  const a=new ImageData(3,1);a.data.set([100,0,0,255,100,0,0,255,100,0,0,255]);
  const b=new ImageData(3,1);b.data.set([200,0,0,255,200,0,0,255,200,0,0,255]);
  blendTile(output,weights,a,0,0,{overlap:1,sourceX:0,sourceY:0,sourceWidth:2,sourceHeight:1,coreW:1,coreH:1});
  blendTile(output,weights,b,1,0,{overlap:1,sourceX:1,sourceY:0,sourceWidth:2,sourceHeight:1,coreW:1,coreH:1});
  assert.ok(output.data[4] > 100 && output.data[4] < 200);
});
