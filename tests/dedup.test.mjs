import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDuplicatePlan, byteFingerprint, bytesEqual} from '../src/dedup.js';

const tex=(hash,size)=>({hash,path:`Shared/${hash}.png`,size});

test('duplicate plan reuses only exact byte-identical textures',async()=>{
  const textures=[tex('aaaaaaaaaaaaaaaa',4),tex('bbbbbbbbbbbbbbbb',4),tex('cccccccccccccccc',4),tex('dddddddddddddddd',2)];
  const data=new Map([
    [textures[0].path,new Uint8Array([1,2,3,4])],
    [textures[1].path,new Uint8Array([1,2,3,4])],
    [textures[2].path,new Uint8Array([1,2,3,5])],
    [textures[3].path,new Uint8Array([9,9])],
  ]);
  let reads=0;
  const plan=await buildDuplicatePlan(textures,async t=>{reads++;return data.get(t.path)});
  assert.equal(plan.duplicates,1);
  assert.equal(plan.uniqueSources,3);
  assert.equal(plan.groups.find(g=>g.members.length===2).members[1].hash,'bbbbbbbbbbbbbbbb');
  assert.equal(reads,3,'unique-size texture does not need a duplicate-scan read');
});

test('fingerprint collisions cannot merge different bytes because equality is authoritative',()=>{
  assert.equal(bytesEqual(new Uint8Array([1,2,3]),new Uint8Array([1,2,3])),true);
  assert.equal(bytesEqual(new Uint8Array([1,2,3]),new Uint8Array([1,2,4])),false);
  assert.equal(byteFingerprint(new Uint8Array([1,2,3])),byteFingerprint(new Uint8Array([1,2,3])));
});

test('a duplicate-scan read error keeps the texture as a separate safe group',async()=>{
  const textures=[tex('aaaaaaaaaaaaaaaa',4),tex('bbbbbbbbbbbbbbbb',4)];
  const plan=await buildDuplicatePlan(textures,async t=>{
    if(t.hash.startsWith('a')) throw new Error('temporary read failure');
    return new Uint8Array([1,2,3,4]);
  });
  assert.equal(plan.groups.length,2);
  assert.equal(plan.duplicates,0);
  assert.equal(plan.unverified,1);
});
