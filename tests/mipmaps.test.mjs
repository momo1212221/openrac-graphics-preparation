import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alphaCoverage,mipDimensions,preserveAlphaCoverage,shouldGenerateMipmaps} from '../src/mipmaps.js';

test('mip dimensions halve until the requested floor',()=>{
  assert.deepEqual(mipDimensions(256,128,{maxLevels:4}),[
    {level:1,width:128,height:64},
    {level:2,width:64,height:32},
    {level:3,width:32,height:16},
    {level:4,width:16,height:8},
  ]);
  assert.deepEqual(mipDimensions(3,1,{maxLevels:8}),[
    {level:1,width:1,height:1},
  ]);
});

test('cutout alpha coverage can be restored after filtering',()=>{
  const data=new Uint8ClampedArray([
    0,0,0,70, 0,0,0,90, 0,0,0,170, 0,0,0,190,
  ]);
  const before=alphaCoverage(data,128);
  assert.equal(before,.5);
  const fixed=preserveAlphaCoverage(data,.75,128);
  assert.ok(fixed.bias>0);
  assert.ok(fixed.coverage>=.75);
});

test('mipmap policy excludes technical and UI textures',()=>{
  assert.equal(shouldGenerateMipmaps('normal','generic','all'),false);
  assert.equal(shouldGenerateMipmaps('mask','generic','all'),false);
  assert.equal(shouldGenerateMipmaps('ui','generic','all'),false);
  assert.equal(shouldGenerateMipmaps('diffuse','stone','key'),true);
  assert.equal(shouldGenerateMipmaps('diffuse','generic','key'),false);
  assert.equal(shouldGenerateMipmaps('diffuse','generic','all'),true);
});
