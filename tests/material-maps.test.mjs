import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveMaterialMaps,shouldGenerateMaterialMaps} from '../src/material-maps.js';

const image=(w,h,fn)=>{
 const data=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(fn(x,y),(y*w+x)*4);
 return {width:w,height:h,data};
};

test('derived maps keep dimensions and valid tangent normals',()=>{
 const src=image(5,5,(x,y)=>[80+x*20,70+y*15,60,255]);
 const maps=deriveMaterialMaps(src,'stone');
 for(const name of ['normal','roughness','height','ao','emissive']){
   assert.equal(maps[name].width,5);assert.equal(maps[name].height,5);
   assert.equal(maps[name].data.length,5*5*4);
 }
 const i=(2*5+2)*4;
 const nx=maps.normal.data[i]/127.5-1,ny=maps.normal.data[i+1]/127.5-1,nz=maps.normal.data[i+2]/127.5-1;
 assert.ok(Math.abs(Math.hypot(nx,ny,nz)-1)<.03);
});

test('energy material extracts emissive pixels while dark generic remains non-emissive',()=>{
 const bright=image(2,2,()=>[250,80,20,255]);
 const dark=image(2,2,()=>[30,25,20,255]);
 assert.ok(deriveMaterialMaps(bright,'energy').emissivePixels>0);
 assert.equal(deriveMaterialMaps(dark,'generic').emissivePixels,0);
});

test('material map generation policy stays off for current stock launcher by default',()=>{
 assert.equal(shouldGenerateMaterialMaps('diffuse','stone','off'),false);
 assert.equal(shouldGenerateMaterialMaps('diffuse','stone','key'),true);
 assert.equal(shouldGenerateMaterialMaps('ui','generic','all'),false);
});
