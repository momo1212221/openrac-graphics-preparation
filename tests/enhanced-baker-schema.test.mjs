import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BAKER_RESOLUTIONS,bakerSettingsIssues,normalizeBakerSettings} from '../src/enhanced-baker-schema.js';

test('stock profile seeds editor values',()=>{
 const out=normalizeBakerSettings({},{sky_intensity:.7,sky_weight:.4,surface_emission_scale:2,rays:512,bounces:5,adaptive_rays:false,environment_probes:{enabled:true,resolution:128,maximum_probes:256,spacing:48}});
 assert.deepEqual(out,{skyIntensity:.7,skyWeight:.4,surfaceEmissionScale:2,environmentProbes:true,probeResolution:128,maximumProbes:256,spacing:48,rays:512,bounces:5,adaptiveRays:false});
});

test('normalization snaps unsafe values into stock limits',()=>{
 const out=normalizeBakerSettings({skyIntensity:-1,skyWeight:4,surfaceEmissionScale:-2,probeResolution:96,maximumProbes:900,spacing:1,rays:1,bounces:99});
 assert.equal(out.skyIntensity,0); assert.equal(out.skyWeight,1); assert.equal(out.surfaceEmissionScale,0); assert.equal(out.probeResolution,64); assert.equal(out.maximumProbes,512); assert.equal(out.spacing,2); assert.equal(out.rays,16); assert.equal(out.bounces,32);
});

test('strict checker matches power-of-two and budget rules',()=>{
 const valid=normalizeBakerSettings({}); assert.deepEqual(bakerSettingsIssues(valid),[]); assert.ok(BAKER_RESOLUTIONS.includes(valid.probeResolution));
 const issues=bakerSettingsIssues({...valid,probeResolution:96,maximumProbes:513,spacing:1,rays:15,bounces:33}).join('\n');
 assert.match(issues,/power of two/); assert.match(issues,/1 to 512/); assert.match(issues,/between 2 and 1024/); assert.match(issues,/16 to 1048576/); assert.match(issues,/0 to 32/);
});
