import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cacheKey,cacheKeyMatchesDigest,newestCacheRowForDigest} from '../src/ai-cache.js';

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


test('material sidecar settings do not invalidate cached AI pixels',()=>{
  const digest='cd'.repeat(32);
  const base={
    mode:'balanced',detailQuality:'high',textureScope:'world',detailCnn:true,
    sourceColorLock:true,qualityGuard:true,preserveMicrodetail:true,preserveStars:true,
    master8x:true,specializedFingerprint:'model-a',
  };
  assert.equal(
    cacheKey(digest,{...base,materialMaps:'off',materialCurvature:false}),
    cacheKey(digest,{...base,materialMaps:'all',materialCurvature:true}),
  );
});

test('cache key is null without a cryptographic source digest',()=>{
  assert.equal(cacheKey(null,{mode:'balanced'}),null);
});


test('latest cached AI result is selected by source digest, not current settings',()=>{
  const digest='ef'.repeat(32);
  const older={
    key:cacheKey(digest,{mode:'faithful',detailQuality:'high',textureScope:'world'}),
    bytes:new Uint8Array([1]),created:100,lastUsed:900,detailQuality:'high',
  };
  const latest={
    key:cacheKey(digest,{mode:'enhanced',detailQuality:'max',textureScope:'world',master8x:true}),
    bytes:new Uint8Array([2]),created:200,lastUsed:300,detailQuality:'max',
  };
  const otherDigest='12'.repeat(32);
  const unrelated={
    key:cacheKey(otherDigest,{mode:'enhanced',detailQuality:'max'}),
    bytes:new Uint8Array([3]),created:999,lastUsed:999,
  };
  assert.equal(cacheKeyMatchesDigest(latest.key,digest),true);
  assert.equal(cacheKeyMatchesDigest(unrelated.key,digest),false);
  assert.equal(newestCacheRowForDigest([older,unrelated,latest],digest),latest);
});

test('legacy cache rows without created timestamp fall back to lastUsed ordering',()=>{
  const digest='34'.repeat(32);
  const a={key:cacheKey(digest,{mode:'balanced',detailQuality:'high'}),bytes:new Uint8Array([1]),lastUsed:10};
  const b={key:cacheKey(digest,{mode:'balanced',detailQuality:'max'}),bytes:new Uint8Array([2]),lastUsed:20};
  assert.equal(newestCacheRowForDigest([a,b],digest),b);
});
