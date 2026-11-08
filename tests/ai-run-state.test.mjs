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

test("run store key is game scoped and sanitized",()=>{
  assert.equal(aiRunStoreKey("RAC 1/NTSC"),"texture-preparation-ai-run-v1:rac-1-ntsc");
});


test("AI run signature is pinned to the strict quality-policy generation",()=>{
  assert.match(RUN_PIPELINE,/90-94-97-v3-alpha/);
  assert.match(aiRunSignature({}),/90-94-97-v3-alpha/);
});
