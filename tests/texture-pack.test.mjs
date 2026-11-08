import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textureFiles, texturePackManifest, outputName, packPath} from '../src/texture-pack.js';

test('saved OpenRAC texture files are deduplicated by texture hash',()=>{
  const files=[
    {path:'Interface/aaaaaaaaaaaaaaaa.png',size:10},
    {path:'Planets/Novalis/bbbbbbbbbbbbbbbb.png',size:20},
    {path:'Shared/bbbbbbbbbbbbbbbb.png',size:20},
    {path:'Shared/not-a-texture.png',size:1},
  ];
  assert.deepEqual(textureFiles(files).map(x=>x.hash),['aaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbb']);
  assert.deepEqual(textureFiles(files,{includeInterface:false}).map(x=>x.hash),['bbbbbbbbbbbbbbbb']);
  assert.equal(packPath(textureFiles(files)[0]),'Upscaled/aaaaaaaaaaaaaaaa.png');
});

test('standard fallback pack metadata names the current mod version',()=>{
  const info={packId:'rac1-pal'};
  const manifest=texturePackManifest(info,42,4,true);
  assert.deepEqual(manifest,{format:1,game:'rac1-pal',name:'Graphics preparation 4x',textures:42,madeWith:'Graphics preparation 0.4.0 (edge-preserving)'});
  assert.equal(outputName(info,4),'rac1-pal-graphics-preparation-4x');
});
