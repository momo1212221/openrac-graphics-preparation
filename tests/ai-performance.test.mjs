import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hardwareSnapshot,laneCeiling,normalizePerformanceMode,selectMeasuredLaneCount} from '../src/ai-performance.js';

test('performance mode normalization is bounded',()=>{
  assert.equal(normalizePerformanceMode('auto'),'auto');
  assert.equal(normalizePerformanceMode(2),'2');
  assert.equal(normalizePerformanceMode('9'),'auto');
});

test('auto lane ceiling is conservative on CPU and scales with WebGPU hardware hints',()=>{
  assert.equal(laneCeiling({backend:'wasm',hardware:{hardwareConcurrency:16,deviceMemoryGb:16}}),1);
  assert.equal(laneCeiling({backend:'webgpu',hardware:{hardwareConcurrency:4,deviceMemoryGb:8}}),1);
  assert.equal(laneCeiling({backend:'webgpu',hardware:{hardwareConcurrency:8,deviceMemoryGb:8}}),2);
  assert.equal(laneCeiling({backend:'webgpu',hardware:{hardwareConcurrency:16,deviceMemoryGb:16}}),3);
  assert.equal(laneCeiling({backend:'webgpu',mode:'3',hardware:{hardwareConcurrency:2,deviceMemoryGb:4}}),3);
});

test('hardware snapshot tolerates missing privacy-limited properties',()=>{
  assert.deepEqual(hardwareSnapshot({hardwareConcurrency:8,gpu:{}}),{
    hardwareConcurrency:8,deviceMemoryGb:null,webgpu:true,
  });
});

test('autotune only increases lanes for a measurable throughput win',()=>{
  assert.equal(selectMeasuredLaneCount([
    {lanes:1,runs:2,elapsedMs:200},
    {lanes:2,runs:4,elapsedMs:260},
    {lanes:3,runs:6,elapsedMs:390},
  ]),2);
  assert.equal(selectMeasuredLaneCount([
    {lanes:1,runs:2,elapsedMs:200},
    {lanes:2,runs:4,elapsedMs:380},
  ]),1);
});
