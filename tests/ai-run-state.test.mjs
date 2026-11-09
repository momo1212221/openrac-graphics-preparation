import {test} from "node:test";
import assert from "node:assert/strict";
import {
  RUN_PIPELINE,aiRunSignature,aiRunStoreKey,beginAiRun,checkpointAiRun,interruptAiRun,completeAiRun,aiRunProgress,
} from "../src/ai-run-state.js";

test("AI run journal resumes only the same game/profile",()=>{
  const state={aiMode:"balanced",detailQuality:"max",detailCnn:true,includeInterface:true};
  const signature=aiRunSignature(state);
  let run=beginAiRun(null,{packId:"rac1",signature,hashes:["aa","bb","cc"]});
  run=checkpointAiRun(run,["aa","bb"]);
  let progress=aiRunProgress(run,{packId:"rac1",signature,hashes:["aa","bb","cc"]});
  assert.equal(progress.compatible,true);
  assert.equal(progress.completed,2);
  assert.equal(progress.percent,67);
  progress=aiRunProgress(run,{packId:"rac1",signature:aiRunSignature({...state,aiMode:"enhanced"}),hashes:["aa","bb","cc"]});
  assert.equal(progress.compatible,false);
});

test("interrupted and complete run states are explicit",()=>{
  const signature=aiRunSignature({});
  let run=beginAiRun(null,{packId:"rac1",signature,hashes:["aa","bb"]});
  run=checkpointAiRun(run,["aa"]);
  run=interruptAiRun(run);
  assert.equal(run.status,"interrupted");
  run=completeAiRun(run);
  assert.equal(run.status,"complete");
  assert.deepEqual(new Set(run.completedHashes),new Set(["aa","bb"]));
});

test("run store key is game scoped and launcher-safe",()=>{
  const key=aiRunStoreKey("RAC 1/NTSC.foo:beta");
  assert.equal(key,"texture-preparation-ai-run-v1-rac-1-ntsc-foo-beta");
  assert.match(key,/^[a-z0-9_-]+$/);
  assert.ok(key.length<=64);
  const longKey=aiRunStoreKey("A".repeat(200));
  assert.match(longKey,/^[a-z0-9_-]+$/);
  assert.equal(longKey.length,64);
});


test("AI run signature is pinned to the strict quality-policy generation",()=>{
  assert.match(RUN_PIPELINE,/90-94-97-v4-regional/);
  assert.match(aiRunSignature({}),/90-94-97-v4-regional/);
});


test('performance lanes do not invalidate resumable AI work',()=>{
  const base={aiMode:'enhanced',detailQuality:'max',detailCnn:true,includeInterface:true,performanceMode:'1'};
  assert.equal(aiRunSignature(base),aiRunSignature({...base,performanceMode:'8'}));
});
