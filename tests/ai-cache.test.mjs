import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cacheKey} from '../src/ai-cache.js';

test('cache keys include source digest and all output-affecting detail options',()=>{
  const digest='ab'.repeat(32);
  const a=cacheKey(digest,{mode:'balanced',detailQuality:'high',textureScope:'world',detailCnn:true,sourceColorLock:true,preserveMicrodetail:true,preserveStars:true});
  const b=cacheKey(digest,{mode:'faithful',detailQuality:'high',textureScope:'world',preserveMicrodetail:true,preserveStars:true});
  const c=cacheKey(digest,{mode:'balanced',detailQuality:'max',textureScope:'world',preserveMicrodetail:true,preserveStars:true});
  const d=cacheKey(digest,{mode:'balanced',detailQuality:'high',textureScope:'ui',preserveMicrodetail:true,preserveStars:true});
  assert.notEqual(a,b);
  assert.notEqual(a,c);
  assert.notEqual(a,d);
  assert.match(a,/realesrgan-x4plus/);
  assert.match(a,/high/);
  assert.match(a,/world/);
  assert.match(a,/micro1/);
  assert.match(a,/stars1/);
});

test('cache key is null without a cryptographic source digest',()=>{
  assert.equal(cacheKey(null,{mode:'balanced'}),null);
});
