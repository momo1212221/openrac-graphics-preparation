import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyTexture,pathTextureScope} from '../src/texture-classify.js';

const image=(w,h,fn)=>{
  const data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(fn(x,y),(y*w+x)*4);
  return {width:w,height:h,data};
};

test('Interface paths are always classified conservatively as UI',()=>{
  assert.equal(pathTextureScope(['Interface/aaaaaaaaaaaaaaaa.png']),'ui');
  assert.equal(classifyTexture(['Interface/a.png'],image(2,2,()=>[20,40,220,255])).kind,'ui');
});

test('conservative blue tangent-space signature detects normal maps',()=>{
  const normal=image(16,16,(x,y)=>[120+(x%3),126+(y%3),240,255]);
  const out=classifyTexture(['Shared/hash.png'],normal);
  assert.equal(out.kind,'normal');
  assert.ok(out.confidence>=0.9);
});

test('ordinary coloured texture remains diffuse',()=>{
  const diffuse=image(16,16,(x,y)=>[40+x*5,70+y*4,60+(x+y)%20,255]);
  assert.equal(classifyTexture(['Shared/hash.png'],diffuse).kind,'diffuse');
});
