import {test} from 'node:test';
import assert from 'node:assert/strict';
import {automaticDetailQuality,refinedDetailQuality} from '../src/quality-planner.js';

test('automatic planner reserves max detail for important assets',()=>{
  assert.equal(automaticDetailQuality({path:'Characters/Ratchet/body.png',size:200000},'auto'),'max');
  assert.equal(automaticDetailQuality({path:'Interface/font.png',size:200000},'auto'),'standard');
  assert.equal(automaticDetailQuality({path:'World/terrain/rock.png',size:200000},'auto'),'high');
});

test('global explicit quality bypasses automatic planning',()=>{
  assert.equal(automaticDetailQuality({path:'Characters/Ratchet/body.png',size:200000},'standard'),'standard');
});

test('measured fidelity can promote or demote the second pass',()=>{
  assert.equal(refinedDetailQuality({textureClass:'diffuse',material:'weapon',metrics:{score:90,cnnAgreement:.9,colorDrift:5,edgeGain:1.2}},'high'),'max');
  assert.equal(refinedDetailQuality({textureClass:'diffuse',material:'stone',metrics:{score:60,cnnAgreement:.3,colorDrift:5,edgeGain:1.2}},'max'),'standard');
});
