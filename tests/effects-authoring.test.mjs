import {test} from 'node:test';
import assert from 'node:assert/strict';
import {manifestObjectPosition,normalizeEffects,normalizeParticle,objectLightCatalog,bakerProfile,particleConfig} from '../src/effects-authoring.js';

test('runtime point and spot lights serialize to the official object-lights format',()=>{
  const state=normalizeEffects({lights:[
    {object:'mobys/lamp',type:'point',position:[1,2,3],colour:[1,.5,.2],intensity:7,range:10},
    {object:'mobys/weapon',type:'spot',direction:[0,0,-1],inner_angle:.2,outer_angle:.4},
  ]});
  const out=objectLightCatalog(state);
  assert.equal(out.version,1);
  assert.equal(out.objects['mobys/lamp'][0].type,'point');
  assert.equal(out.objects['mobys/weapon'][0].type,'spot');
  assert.deepEqual(out.objects['mobys/lamp'][0].position,[1,2,3]);
});

test('baker authoring preserves existing profile and adds official area_lights',()=>{
  const state=normalizeEffects({
    baker:{skyIntensity:.7,skyWeight:.4,surfaceEmissionScale:2,environmentProbes:true,probeResolution:64,maximumProbes:256,spacing:16},
    areaLights:[{level:'level_01',position:[1,2,3],axis_u:[2,0,0],axis_v:[0,2,0],radiance:[5,4,3]}],
  });
  const out=bakerProfile({version:1,regions:{adaptive_density:true}},state,'level_01');
  assert.equal(out.regions.adaptive_density,true);
  assert.equal(out.sky_intensity,.7);
  assert.equal(out.surface_emission_scale,2);
  assert.deepEqual(out.area_lights[0].radiance,[5,4,3]);
});

test('particle config is deterministic TSV for the standard native runtime',()=>{
  const state=normalizeEffects({particles:[{level:'level_02',preset:'sparks',position:[1,2,3],rate:12}]});
  const text=particleConfig(state,[{dir:'level_02',level:2}]);
  assert.match(text,/^# OpenRAC Graphics Effects Runtime v1/m);
  assert.match(text,/^2\tsparks\t1\t2\t3\t/m);
});


test('runtime effects require explicit placement instead of silently exporting at world origin',()=>{
  const unplaced=normalizeParticle({level:'level_02',preset:'smoke'});
  assert.equal(unplaced.placement,'unplaced');
  assert.deepEqual(unplaced.position,[0,0,0]);

  const placed=normalizeParticle({level:'level_02',preset:'smoke',position:[4,5,6]});
  assert.equal(placed.placement,'manual');

  const state=normalizeEffects({particles:[
    {level:'level_02',preset:'smoke'},
    {level:'level_02',preset:'sparks',position:[1,2,3]},
  ]});
  const text=particleConfig(state,[{dir:'level_02',level:2}]);
  assert.doesNotMatch(text,/\tsmoke\t/);
  assert.match(text,/^2\tsparks\t1\t2\t3\t/m);
});

test('exported object transforms can provide placement anchors',()=>{
  assert.deepEqual(manifestObjectPosition({position:[1,2,3]}),[1,2,3]);
  assert.deepEqual(manifestObjectPosition({transform:{translation:[4,5,6]}}),[4,5,6]);
  assert.deepEqual(manifestObjectPosition({matrix:[1,0,0,0,0,1,0,0,0,0,1,0,7,8,9,1]}),[7,8,9]);
  assert.equal(manifestObjectPosition({name:'no transform'}),null);
});
