import test from 'node:test';
import assert from 'node:assert/strict';
import {modernGraphicsPreset} from '../src/modern-preset.js';

test('global Modern PS5 target enables guarded high-quality texture and geometry paths',()=>{
  const preset=modernGraphicsPreset({cacheBudgetMb:4096});
  assert.equal(preset.aiMode,'enhanced');
  assert.equal(preset.detailQuality,'auto');
  assert.equal(preset.detailCnn,true);
  assert.equal(preset.sourceColorLock,true);
  assert.equal(preset.qualityGuard,true);
  assert.equal(preset.master8x,true);
  assert.equal(preset.materialMaps,'key');
  assert.equal(preset.mipmapMaps,undefined);
  assert.equal(preset.mipmaps,'key');
  assert.equal(preset.geometryProfile,'modern');
  assert.equal(preset.geometryAdaptiveSubdivision,true);
  assert.equal(preset.geometryShapeRefine,true);
  assert.equal(preset.geometryAllowCollisionMismatch,false);
  assert.equal(preset.geometryTriangleBudget,0);
  assert.equal(preset.cacheBudgetMb,4096);
});
