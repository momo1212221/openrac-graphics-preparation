import {test} from "node:test";
import assert from "node:assert/strict";
import {ProgressEstimator,formatDuration} from "../src/progress-estimator.js";

test("formats useful human durations",()=>{
  assert.equal(formatDuration(0),"0 s");
  assert.equal(formatDuration(65_000),"1 min 5 s");
  assert.equal(formatDuration(3_665_000),"1 h 1 min");
});

test("estimator reports percentage, rate and ETA after stable samples",()=>{
  let now=0;
  const p=new ProgressEstimator({now:()=>now,minEtaMs:1000,alpha:.2});
  p.reset(100);
  now=10_000;
  p.update(10,100);
  now=20_000;
  const s=p.update(20,100);
  assert.equal(Math.round(s.percent),20);
  assert.ok(s.unitsPerMinute>55&&s.unitsPerMinute<65);
  assert.ok(s.etaMs>70_000&&s.etaMs<100_000);
});

test("cache jumps advance percent without poisoning measured rate",()=>{
  let now=0;
  const p=new ProgressEstimator({now:()=>now,minEtaMs:0});
  p.reset(100);
  now=10_000;
  p.update(10,100);
  now=10_100;
  const jumped=p.update(60,100,{sampleRate:false});
  assert.equal(Math.round(jumped.percent),60);
  assert.ok(jumped.unitsPerMinute<100);
});

test("paused time is excluded from elapsed time and ETA sampling",()=>{
  let now=0;
  const p=new ProgressEstimator({now:()=>now,minEtaMs:0});
  p.reset(100);
  now=10_000;
  p.update(10,100);
  p.pause();
  now=70_000;
  p.resume();
  now=80_000;
  const s=p.update(20,100);
  assert.equal(Math.round(s.elapsedMs/1000),20);
  assert.ok(s.etaMs>0);
});
