import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildQualityReport} from '../src/quality-report.js';

const row=(hash,score,failures=[])=>({
  hash,path:hash+'.png',strategy:'ai',textureClass:'diffuse',material:'stone',
  detailQuality:'high',backend:'wasm',masterScale:4,metrics:{score},failures:{issues:failures},
  specializedCnnUsed:hash==='a',specializedRejected:hash==='b',
  specializedModelSha:hash==='a'?'c'.repeat(64):null,
});

test('quality report ranks best/worst and keeps detected failures',()=>{
  const report=buildQualityReport([row('a',91),row('b',44,['hallucination-risk']),row('c',72)],{limit:2});
  assert.equal(report.evaluated,3);
  assert.deepEqual(report.worst.map(x=>x.hash),['b','c']);
  assert.deepEqual(report.best.map(x=>x.hash),['a','c']);
  assert.equal(report.failureCount,1);
  assert.deepEqual(report.failures[0].failures,['hallucination-risk']);
  assert.equal(report.averageScore,69);
  assert.equal(report.tiers.standard.threshold,90);
  assert.equal(report.tiers.standard.count,1);
  assert.equal(report.tiers.standard.rate,33.33);
  assert.equal(report.tiers.high.count,0);
  assert.equal(report.tiers.max.count,0);
  assert.equal(report.belowStandardCount,2);
  assert.equal(report.percentiles.min,44);
  assert.equal(report.percentiles.p50,72);
  assert.equal(report.percentiles.max,91);
  assert.equal(report.best[0].specializedCnnUsed,true);
  assert.equal(report.best[0].specializedModelSha,'c'.repeat(64));
  assert.equal(report.failures[0].specializedRejected,true);
});

test('fallback outputs are retained even without a score',()=>{
  const report=buildQualityReport([{hash:'x',path:'x.png',strategy:'fallback',metrics:null}],{limit:20});
  assert.equal(report.scored,0);
  assert.equal(report.failureCount,1);
  assert.equal(report.worst.length,0);
});


test('quality report includes compact material-sidecar validation',()=>{
 const report=buildQualityReport([],{materialMaps:[{
   hash:'m',path:'m.png',material:'metal',
   quality:{ok:false,issues:['normal-length'],meanNormalLengthError:.12,backwardNormalPercent:0,normalTilt:{meanDeg:18,p95Deg:42,steepPercent:1},heightRelief:{min:.2,max:.8,mean:.5,range:.6},reliefWarnings:['normal-steep-tail'],worstSeam:18,scalarStats:{roughness:{min:.2,max:.8,mean:.5}},seamScores:{normal:18}}
 }]});
 assert.equal(report.materialMaps.length,1);
 assert.equal(report.materialMaps[0].ok,false);
 assert.deepEqual(report.materialMaps[0].issues,['normal-length']);
 assert.equal(report.materialMaps[0].worstSeam,18);
 assert.equal(report.materialMaps[0].normalTilt.p95Deg,42);
 assert.equal(report.materialMaps[0].heightRelief.range,.6);
 assert.deepEqual(report.materialMaps[0].reliefWarnings,['normal-steep-tail']);
});


test('quality report exposes 90/94/97 distribution and p99',()=>{
  const report=buildQualityReport([
    row('s90',90),row('h94',94),row('m97',97),row('m99',99),row('low',89),
  ]);
  assert.equal(report.tiers.standard.count,4);
  assert.equal(report.tiers.standard.rate,80);
  assert.equal(report.tiers.high.count,3);
  assert.equal(report.tiers.high.rate,60);
  assert.equal(report.tiers.max.count,2);
  assert.equal(report.tiers.max.rate,40);
  assert.equal(report.belowStandardCount,1);
  assert.ok(report.percentiles.p99>98);
});


test('quality report identifies weak material classes',()=>{
  const stoneA=row('stone-a',95);
  const stoneB=row('stone-b',92);
  const glassA={...row('glass-a',88),material:'glass'};
  const glassB={...row('glass-b',91),material:'glass'};
  const report=buildQualityReport([stoneA,stoneB,glassA,glassB]);
  const glass=report.materialBreakdown.find((x)=>x.material==='glass');
  const stone=report.materialBreakdown.find((x)=>x.material==='stone');
  assert.equal(glass.count,2);
  assert.equal(glass.standardRate,50);
  assert.equal(glass.belowStandard,1);
  assert.equal(stone.standardRate,100);
  assert.equal(report.materialBreakdown[0].material,'glass');
});
