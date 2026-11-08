import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textureFiles, texturePackManifest, outputName, packPath} from '../src/texture-pack.js';

test('saved OpenRAC texture files are deduplicated by texture hash',()=>{
  const files=[
    {path:'Interface/aaaaaaaaaaaaaaaa.png',size:10},
    {path:'Planets/Novalis/bbbbbbbbbbbbbbbb.png',size:20},
    {path:'Shared/bbbbbbbbbbbbbbbb.png',size:20},
  ];
  assert.deepEqual(textureFiles(files).map(x=>x.hash),['aaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbb']);
  assert.equal(packPath(textureFiles(files)[0]),'Upscaled/aaaaaaaaaaaaaaaa.png');
});

test('AI pack metadata identifies bundled Real-ESRGAN path',()=>{
  const info={packId:'rac1-pal'};
  const manifest=texturePackManifest(info,42,{ai:true,mode:'balanced',detailQuality:'high'});
  assert.equal(manifest.game,'rac1-pal');
  assert.equal(manifest.name,'Graphics preparation AI 4x');
  assert.ok(manifest.madeWith.includes('0.10.1 (dual-CNN balanced · high detail)'));
  assert.equal(outputName(info,'ai-balanced-4x'),'rac1-pal-graphics-preparation-ai-balanced-4x');
});
