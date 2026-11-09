import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_INFERENCE_LANES,hardwareSnapshot,laneCeiling,normalizePerformanceMode,selectMeasuredLaneCount,shouldStopAutotune} from '../src/ai-performance.js';

test('performance mode normalization is bounded',()=>{
  assert.equal(normalizePerformanceMode('auto'),'auto');
  assert.equal(normalizePerformanceMode(2),'2');
  assert.equal(normalizePerformanceMode('8'),'8');
  assert.equal(normalizePerformanceMode('9'),'auto');
  assert.equal(MAX_INFERENCE_LANES,8);
});

test('auto lane ceiling is conservative on CPU and scales with WebGPU hardware hints',()=>{
  assert.equal(laneCeiling({backend:'wasm',hardware:{hardwareConcurrency:16,deviceMemoryGb:16}}),1);
  assert.equal(laneCeiling({backend:'webgpu',hardware:{hardwareConcurrency:4,deviceMemoryGb:8}}),4);
  assert.equal(laneCeiling({backend:'webgpu',hardware:{hardwareConcurrency:8,deviceMemoryGb:8}}),8);
  assert.equal(laneCeiling({backend:'webgpu',hardware:{hardwareConcurrency:16,deviceMemoryGb:16}}),8);
  assert.equal(laneCeiling({backend:'webgpu',mode:'8',hardware:{hardwareConcurrency:2,deviceMemoryGb:4}}),8);
  assert.equal(laneCeiling({backend:'webgpu',hardware:{hardwareConcurrency:8,deviceMemoryGb:3}}),1);
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
    {lanes:4,runs:8,elapsedMs:480},
  ]),4);
  assert.equal(selectMeasuredLaneCount([
    {lanes:1,runs:2,elapsedMs:200},
    {lanes:2,runs:4,elapsedMs:380},
  ]),1);
});


test('autotune stops after two consecutive lanes fail to improve enough',()=>{
  assert.equal(shouldStopAutotune([
    {lanes:1,runs:4,elapsedMs:400},
    {lanes:2,runs:4,elapsedMs:240},
  ]),false);
  assert.equal(shouldStopAutotune([
    {lanes:1,runs:4,elapsedMs:400},
    {lanes:2,runs:4,elapsedMs:240},
    {lanes:3,runs:6,elapsedMs:350},
    {lanes:4,runs:8,elapsedMs:470},
  ]),true);
  assert.equal(shouldStopAutotune([
    {lanes:1,runs:4,elapsedMs:400},
    {lanes:2,runs:4,elapsedMs:240},
    {lanes:3,runs:6,elapsedMs:300},
    {lanes:4,runs:8,elapsedMs:360},
  ]),false);
});
