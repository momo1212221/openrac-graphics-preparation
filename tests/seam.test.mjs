import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectTextureWrap} from '../src/seam.js';
import {MODEL_INPUT,fillFixedRgbTile} from '../src/ai-tile.js';

const image=(w,h,fn)=>{
 const data=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(fn(x,y),(y*w+x)*4);
 return {width:w,height:h,data};
};

test('seam detector recognizes a horizontally repeating material',()=>{
 const src=image(8,8,(x,y)=>{
   const xx=x===7?0:x;
   return [40+(xx%3)*20,70+(y%2)*10,80,255];
 });
 const wrap=detectTextureWrap(src,{textureClass:'diffuse',material:'stone'});
 assert.equal(wrap.x,true);
});

test('UI textures never wrap automatically',()=>{
 const src=image(8,8,(x,y)=>[x*20,y*20,40,255]);
 assert.deepEqual(detectTextureWrap(src,{textureClass:'ui',material:'ui'}).x,false);
});

test('tile padding samples the opposite edge when wrapping',()=>{
 const src=image(4,4,(x,y)=>[x*50,y*40,0,255]);
 const buffer=new Float32Array(3*MODEL_INPUT*MODEL_INPUT);
 fillFixedRgbTile(src,0,0,buffer,1,{x:true,y:false});
 // First model texel maps to source x=-1 => wrapped source x=3.
 assert.equal(Math.round(buffer[0]*255),150);
});
