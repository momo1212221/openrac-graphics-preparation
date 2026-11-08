import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFECTS_SCHEMA_VERSION,effectExportIssues,loadLevels,manifestObjectPosition,
  normalizeEffects,normalizeParticle,objectLightCatalog,bakerProfile,particleConfig,placementsFromLevel,
} from '../src/effects-authoring.js';

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

test('particle config is deterministic TSV for placed runtime effects',()=>{
  const state=normalizeEffects({
    schemaVersion:EFFECTS_SCHEMA_VERSION,
    particles:[{level:'level_02',preset:'sparks',placement:'manual',position:[1,2,3],rate:12}],
  });
  const text=particleConfig(state,[{dir:'level_02',level:2}]);
  assert.match(text,/^# OpenRAC Graphics Effects Runtime v1/m);
  assert.match(text,/^2\tsparks\t1\t2\t3\t/m);
  assert.equal(text.trim().split('\n').at(-1).split('\t').length,17);
});

test('legacy authored particles keep coordinates but require placement confirmation once',()=>{
  const state=normalizeEffects({
    particles:[{level:'level_02',preset:'smoke',position:[4,5,6]}],
  });
  assert.equal(state.schemaVersion,EFFECTS_SCHEMA_VERSION);
  assert.equal(state.particles[0].placement,'unplaced');
  assert.deepEqual(state.particles[0].position,[4,5,6]);

  const confirmed=normalizeEffects({
    schemaVersion:EFFECTS_SCHEMA_VERSION,
    particles:[{level:'level_02',preset:'smoke',placement:'manual',position:[4,5,6]}],
  });
  assert.equal(confirmed.particles[0].placement,'manual');
});

test('invalid coordinates can never remain marked as placed',()=>{
  const bad=normalizeParticle({level:'level_02',preset:'smoke',placement:'manual',position:[1,Number.NaN,3]});
  assert.equal(bad.placement,'unplaced');
  assert.deepEqual(bad.position,[0,0,0]);
});

test('runtime effects require explicit placement instead of silently exporting at world origin',()=>{
  const state=normalizeEffects({
    schemaVersion:EFFECTS_SCHEMA_VERSION,
    particles:[
      {level:'level_02',preset:'smoke',placement:'unplaced',position:[0,0,0]},
      {level:'level_02',preset:'sparks',placement:'manual',position:[1,2,3]},
    ],
  });
  const text=particleConfig(state,[{dir:'level_02',level:2}]);
  assert.doesNotMatch(text,/\tsmoke\t/);
  assert.match(text,/^2\tsparks\t1\t2\t3\t/m);
});

test('OpenRAC placement matrices provide world positions',()=>{
  assert.deepEqual(manifestObjectPosition({matrix:[1,0,0,0,0,1,0,0,0,0,1,0,7,8,9,1]}),[7,8,9]);
  assert.equal(manifestObjectPosition({name:'no transform'}),null);
});

test('placements.json becomes selectable tie shrub and moby instances',()=>{
  const manifest={
    classes:{
      tie:{'5':{mesh:'ties/tie_5.gltf'}},
      shrub:{'6':{mesh:'shrubs/shrub_6.gltf'}},
      moby:{'7':{mesh:null,name:'crate'}},
    },
  };
  const placements={
    ties:[{index:0,class:5,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,1,2,3,1]}],
    shrubs:[{index:2,class:6,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,4,5,6,1]}],
    mobys:[{index:4,class:7,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,7,8,9,1]}],
  };
  const rows=placementsFromLevel(manifest,placements);
  assert.equal(rows.length,3);
  assert.deepEqual(rows.find(x=>x.key==='tie:5:0').position,[1,2,3]);
  assert.deepEqual(rows.find(x=>x.key==='shrub:6:2').position,[4,5,6]);
  assert.deepEqual(rows.find(x=>x.key==='moby:7:4').position,[7,8,9]);
  assert.match(rows.find(x=>x.key==='moby:7:4').label,/crate/);
});

test('level loader reads the official placements.json referenced by manifest',async()=>{
  const enc=new TextEncoder();
  const files={
    'level_03/manifest.json':{
      format:4,level:3,placements:'placements.json',
      classes:{tie:{'5':{mesh:'ties/tie_5.gltf'}},shrub:{},moby:{'7':{mesh:null,name:'crate'}}},
    },
    'level_03/placements.json':{
      format:4,
      ties:[{index:0,class:5,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,2,3,4,1]}],
      shrubs:[],
      mobys:[{index:1,class:7,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,6,7,8,1]}],
    },
  };
  const controller={
    list:async(root)=>root==='levels'?[{path:'level_03/manifest.json'}]:[],
    read:async(root,path)=>{
      assert.equal(root,'levels');
      if(!(path in files))throw new Error('missing fixture '+path);
      return enc.encode(JSON.stringify(files[path])).buffer;
    },
  };
  const levels=await loadLevels(controller);
  assert.equal(levels.length,1);
  assert.equal(levels[0].level,3);
  assert.equal(levels[0].placements.length,2);
  assert.deepEqual(levels[0].placements.find(x=>x.key==='moby:7:1').position,[6,7,8]);
});

test('production export validation catches unplaced invalid-level and malformed coordinates',()=>{
  const levels=[{dir:'level_02',level:2}];
  const state={
    particles:[
      {level:'level_02',preset:'smoke',placement:'unplaced',position:[1,2,3]},
      {level:'level_99',preset:'sparks',placement:'manual',position:[1,2,3]},
      {level:'level_02',preset:'mist',placement:'manual',position:[1,null,3]},
    ],
  };
  const issues=effectExportIssues(state,levels);
  assert.ok(issues.some(x=>x.includes('placement is not confirmed')));
  assert.ok(issues.some(x=>x.includes('level is unavailable')));
  assert.ok(issues.some(x=>x.includes('X/Y/Z must be finite')));
});

test('production export validation accepts confirmed zero coordinates',()=>{
  const issues=effectExportIssues({
    particles:[{level:'level_02',preset:'glow',placement:'manual',position:[0,0,0]}],
  },[{dir:'level_02',level:2}]);
  assert.deepEqual(issues,[]);
});


test('corrupt stored authoring rows normalize without crashing',()=>{
  const state=normalizeEffects({
    schemaVersion:EFFECTS_SCHEMA_VERSION,
    lights:[null,42],
    areaLights:[null],
    particles:[null,'bad'],
  });
  assert.equal(state.lights.length,2);
  assert.equal(state.areaLights.length,1);
  assert.equal(state.particles.length,2);
  assert.ok(state.particles.every((p)=>p.placement==='unplaced'));
});

test('legacy corrupt rows migrate to unplaced instead of becoming origin effects',()=>{
  const state=normalizeEffects({particles:[null,{preset:'smoke',position:[1,2,3]}]});
  assert.equal(state.particles[0].placement,'unplaced');
  assert.equal(state.particles[1].placement,'unplaced');
  assert.deepEqual(state.particles[1].position,[1,2,3]);
});
