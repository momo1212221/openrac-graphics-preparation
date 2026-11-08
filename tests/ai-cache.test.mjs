import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cacheKey} from '../src/ai-cache.js';

test('cache keys include source digest and all output-affecting detail options',()=>{
  const digest='ab'.repeat(32);
  const a=cacheKey(digest,{mode:'balanced',detailQuality:'high',textureScope:'world',detailCnn:true,sourceColorLock:true,qualityGuard:true,preserveMicrodetail:true,preserveStars:true});
  const b=cacheKey(digest,{mode:'faithful',detailQuality:'high',textureScope:'world',preserveMicrodetail:true,preserveStars:true});
  const c=cacheKey(digest,{mode:'balanced',detailQuality:'max',textureScope:'world',preserveMicrodetail:true,preserveStars:true});
  const d=cacheKey(digest,{mode:'balanced',detailQuality:'high',textureScope:'ui',preserveMicrodetail:true,preserveStars:true});
  const e=cacheKey(digest,{mode:'balanced',detailQuality:'high',textureScope:'world',detailCnn:true,sourceColorLock:true,qualityGuard:true,preserveMicrodetail:true,preserveStars:true,specializedFingerprint:'a'.repeat(64)});
  const f=cacheKey(digest,{mode:'balanced',detailQuality:'high',textureScope:'world',detailCnn:true,sourceColorLock:true,qualityGuard:true,preserveMicrodetail:true,preserveStars:true,specializedFingerprint:'b'.repeat(64)});
  const g=cacheKey(digest,{mode:'balanced',detailQuality:'high',textureScope:'world',detailCnn:true,sourceColorLock:true,qualityGuard:true,preserveMicrodetail:true,preserveStars:true,qualityPolicyVersion:'90-94-97-v3-alpha'});
  const h=cacheKey(digest,{mode:'balanced',detailQuality:'high',textureScope:'world',detailCnn:true,sourceColorLock:true,qualityGuard:true,preserveMicrodetail:true,preserveStars:true,qualityPolicyVersion:'old-policy'});
  assert.notEqual(a,b);
  assert.notEqual(a,c);
  assert.notEqual(a,d);
  assert.notEqual(e,f);
  assert.notEqual(g,h);
  assert.match(g,/policy-90-94-97-v3-alpha/);
  assert.match(a,/realesrgan-x4plus/);
  assert.match(a,/high/);
  assert.match(a,/world/);
  assert.match(a,/micro1/);
  assert.match(a,/stars1/);
});

test('cache key is null without a cryptographic source digest',()=>{
  assert.equal(cacheKey(null,{mode:'balanced'}),null);
});
