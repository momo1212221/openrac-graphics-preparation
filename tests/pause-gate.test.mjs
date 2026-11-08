import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PauseGate} from '../src/pause-gate.js';

test('pause gate blocks only after a checkpoint and resumes deterministically',async()=>{
  const gate=new PauseGate();
  assert.equal(await gate.checkpoint(),false);
  gate.request();
  let continued=false;
  const waiting=gate.checkpoint().then(()=>{continued=true});
  await Promise.resolve();
  assert.equal(continued,false);
  assert.equal(gate.requested,true);
  assert.equal(gate.resume(),true);
  await waiting;
  assert.equal(continued,true);
  assert.equal(gate.requested,false);
});

test('reset releases a paused checkpoint safely',async()=>{
  const gate=new PauseGate();
  gate.request();
  let done=false;
  const waiting=gate.checkpoint().then(()=>{done=true});
  await Promise.resolve();
  gate.reset();
  await waiting;
  assert.equal(done,true);
  assert.equal(gate.requested,false);
});
