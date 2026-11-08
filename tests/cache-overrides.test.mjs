import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cacheKey} from '../src/ai-cache.js';
test('manual class/material overrides invalidate cached output identity',()=>{
  const digest='12'.repeat(32),base={mode:'balanced',detailQuality:'high',textureScope:'world',detailCnn:true,sourceColorLock:true,qualityGuard:true};
  assert.notEqual(cacheKey(digest,base),cacheKey(digest,{...base,textureClassOverride:'sky'}));
  assert.notEqual(cacheKey(digest,base),cacheKey(digest,{...base,materialOverride:'stone'}));
});
