import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareTextureFailSafe, readFailSafe} from '../src/resilience.js';

test('one AI failure resets the session and retries without degrading the texture',async()=>{
  let calls=0, resets=0;
  const result=await prepareTextureFailSafe(new Uint8Array([9]),{
    ai:async()=>{calls++; if(calls===1)throw new Error('ort'); return {bytes:new Uint8Array([1,2]),stars:3,microdetails:4};},
    fallback:async()=>new Uint8Array([7]),
    resetAi:async()=>{resets++;},
    retries:1,
  });
  assert.equal(result.strategy,'ai');
  assert.equal(result.attempts,2);
  assert.equal(resets,1);
  assert.deepEqual([...result.bytes],[1,2]);
  assert.equal(result.stars,3);
});

test('two AI failures fall back to deterministic 4x output',async()=>{
  const result=await prepareTextureFailSafe(new Uint8Array([9]),{
    ai:async()=>{throw new Error('ort');},
    fallback:async()=>new Uint8Array([4,4]),
    retries:1,
  });
  assert.equal(result.strategy,'fallback');
  assert.deepEqual([...result.bytes],[4,4]);
  assert.equal(result.errors.length,2);
});

test('if AI and 4x fallback both fail the original PNG bytes survive',async()=>{
  const source=new Uint8Array([137,80,78,71]);
  const result=await prepareTextureFailSafe(source,{
    ai:async()=>{throw new Error('ort');},
    fallback:async()=>{throw new Error('canvas');},
    retries:1,
  });
  assert.equal(result.strategy,'original');
  assert.deepEqual([...result.bytes],[137,80,78,71]);
  assert.equal(result.errors.length,3);
});

test('asset reads retry once before failing',async()=>{
  let calls=0;
  const result=await readFailSafe(async()=>{calls++; if(calls===1)throw new Error('temporary'); return new Uint8Array([1]);},2);
  assert.equal(result.attempts,2);
  assert.deepEqual([...result.bytes],[1]);
});
