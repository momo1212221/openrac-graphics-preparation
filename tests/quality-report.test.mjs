import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildQualityReport} from '../src/quality-report.js';

const row=(hash,score,failures=[])=>({
  hash,path:hash+'.png',strategy:'ai',textureClass:'diffuse',material:'stone',
  detailQuality:'high',backend:'wasm',masterScale:4,metrics:{score},failures:{issues:failures},
});

test('quality report ranks best/worst and keeps detected failures',()=>{
  const report=buildQualityReport([row('a',91),row('b',44,['hallucination-risk']),row('c',72)],{limit:2});
  assert.equal(report.evaluated,3);
  assert.deepEqual(report.worst.map(x=>x.hash),['b','c']);
  assert.deepEqual(report.best.map(x=>x.hash),['a','c']);
  assert.equal(report.failureCount,1);
  assert.deepEqual(report.failures[0].failures,['hallucination-risk']);
  assert.equal(report.averageScore,69);
});

test('fallback outputs are retained even without a score',()=>{
  const report=buildQualityReport([{hash:'x',path:'x.png',strategy:'fallback',metrics:null}],{limit:20});
  assert.equal(report.scored,0);
  assert.equal(report.failureCount,1);
  assert.equal(report.worst.length,0);
});
