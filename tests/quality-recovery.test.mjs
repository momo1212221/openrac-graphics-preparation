import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyQualifiedDowngrade,qualityRecoveryProfiles,qualifiedTier} from '../src/quality-recovery.js';

const metrics=(score,extra={})=>({
  score,colorDrift:4,lumaDrift:5,alphaDrift:0,alphaCoverageDiff:0,
  cnnAgreement:.9,cnnConfidence:.85,cnnRejectedRatio:.05,edgeGain:1.2,
  ssim:.94,hallucinationScore:8,...extra,
});

test('96 max result is accepted as high without rerender',()=>{
  const input={detailQuality:'max',textureClass:'diffuse',material:'stone',metrics:metrics(96)};
  const out=applyQualifiedDowngrade(input);
  assert.equal(out.changed,true);
  assert.equal(out.from,'max');
  assert.equal(out.to,'high');
  assert.equal(out.result.detailQuality,'high');
});

test('92 high result is accepted as standard without rerender',()=>{
  const input={detailQuality:'high',textureClass:'diffuse',material:'metal',metrics:metrics(92)};
  assert.equal(qualifiedTier(input,'high'),'standard');
  assert.equal(applyQualifiedDowngrade(input).result.detailQuality,'standard');
});

test('sub-90 result cannot qualify any tier',()=>{
  const input={detailQuality:'high',textureClass:'diffuse',material:'metal',metrics:metrics(89)};
  assert.equal(qualifiedTier(input,'high'),null);
  assert.equal(applyQualifiedDowngrade(input).changed,false);
});

test('glass recovery disables microdetail and uses faithful first',()=>{
  const profiles=qualityRecoveryProfiles({
    material:'glass',metrics:metrics(84,{hallucinationScore:35})
  },{preserveStars:true});
  assert.equal(profiles[0].mode,'faithful');
  assert.equal(profiles[0].detailQuality,'standard');
  assert.equal(profiles[0].detailCnn,false);
  assert.equal(profiles[0].preserveMicrodetail,false);
  assert.equal(profiles[0].sourceColorLock,true);
});

test('stone recovery preserves source microdetail before falling back further',()=>{
  const profiles=qualityRecoveryProfiles({
    material:'stone',metrics:metrics(87)
  },{preserveStars:true});
  assert.equal(profiles[0].mode,'balanced');
  assert.equal(profiles[0].preserveMicrodetail,true);
  assert.equal(profiles[1].mode,'faithful');
});

test('structural risk forces faithful recovery even for detail-friendly material',()=>{
  const profiles=qualityRecoveryProfiles({
    material:'stone',metrics:metrics(86,{cnnConfidence:.3,cnnRejectedRatio:.5})
  },{preserveStars:true});
  assert.equal(profiles[0].mode,'faithful');
  assert.equal(profiles[0].detailCnn,false);
});
