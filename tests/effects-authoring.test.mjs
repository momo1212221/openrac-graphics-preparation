import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFECTS_SCHEMA_VERSION,bakerExportIssues,bakerSettingsForLevel,effectExportIssues,loadLevels,manifestObjectPosition,mergedAreaLights,
  normalizeAreaLight,normalizeEffects,normalizeParticle,objectLightCatalog,objectLightIssues,bakerProfile,particleConfig,placementsFromLevel,readProbeProfile,setBakerSettingsForLevel,exportEffectsMod,
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
    selectedLevel:'level_01',
    baker:{skyIntensity:.7,skyWeight:.4,surfaceEmissionScale:2,environmentProbes:true,probeResolution:64,maximumProbes:256,spacing:16},
    areaLights:[{level:'level_01',placement:'manual',position:[1,2,3],axis_u:[2,0,0],axis_v:[0,2,0],radiance:[5,4,3]}],
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
  assert.ok(levels[0].objects.some(x=>x.key==='ties/tie_5'), 'gltf extension must not leak into object-light key');
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

test('stock Enhanced baker settings stay inside the real schema',()=>{
  const state=normalizeEffects({schemaVersion:EFFECTS_SCHEMA_VERSION,selectedLevel:'level_01',bakerByLevel:{level_01:{probeResolution:96,maximumProbes:999,spacing:1,rays:2,bounces:99,adaptiveRays:false}}});
  const settings=bakerSettingsForLevel(state,'level_01');
  assert.equal(settings.probeResolution,64); assert.equal(settings.maximumProbes,512); assert.equal(settings.spacing,2); assert.equal(settings.rays,16); assert.equal(settings.bounces,32); assert.equal(settings.adaptiveRays,false);
});

test('baker settings are isolated per exported level',()=>{
  const state=normalizeEffects({schemaVersion:EFFECTS_SCHEMA_VERSION,bakerByLevel:{}});
  setBakerSettingsForLevel(state,'level_01',{...state.baker,skyIntensity:.4,rays:128});
  setBakerSettingsForLevel(state,'level_02',{...state.baker,skyIntensity:1.2,rays:512});
  assert.equal(bakerSettingsForLevel(state,'level_01').skyIntensity,.4); assert.equal(bakerSettingsForLevel(state,'level_01').rays,128);
  assert.equal(bakerSettingsForLevel(state,'level_02').skyIntensity,1.2); assert.equal(bakerSettingsForLevel(state,'level_02').rays,512);
});

test('legacy area lights require placement confirmation before baking',()=>{
  const state=normalizeEffects({schemaVersion:2,selectedLevel:'level_01',areaLights:[{level:'level_01',position:[4,5,6],axis_u:[2,0,0],axis_v:[0,2,0],radiance:[5,4,3]}]});
  assert.equal(state.areaLights[0].placement,'unplaced'); assert.ok(bakerExportIssues(state,'level_01').some(x=>x.includes('placement is not confirmed')));
});

test('baker rejects degenerate area lights and accepts confirmed rectangles',()=>{
  const state=normalizeEffects({schemaVersion:EFFECTS_SCHEMA_VERSION,selectedLevel:'level_01',areaLights:[{level:'level_01',placement:'manual',position:[1,2,3],axis_u:[1,0,0],axis_v:[2,0,0],radiance:[5,4,3]}]});
  assert.ok(bakerExportIssues(state,'level_01').some(x=>x.includes('non-degenerate rectangle')));
  state.areaLights[0]=normalizeAreaLight({level:'level_01',placement:'manual',position:[1,2,3],axis_u:[1,0,0],axis_v:[0,1,0],radiance:[5,4,3]});
  assert.deepEqual(bakerExportIssues(state,'level_01'),[]);
});

test('smog is a first-class runtime preset',()=>{
  const state=normalizeEffects({schemaVersion:EFFECTS_SCHEMA_VERSION,particles:[{level:'level_02',preset:'smog',placement:'manual',position:[1,2,3],rate:3}]});
  assert.equal(state.particles[0].preset,'smog'); assert.match(particleConfig(state,[{dir:'level_02',level:2}]),/^2\tsmog\t1\t2\t3\t/m);
});

test('baker profile writes stock rays bounces and adaptive fields',()=>{
  const state=normalizeEffects({schemaVersion:EFFECTS_SCHEMA_VERSION,selectedLevel:'level_01',bakerByLevel:{level_01:{skyIntensity:.8,skyWeight:.5,surfaceEmissionScale:1,environmentProbes:true,probeResolution:128,maximumProbes:128,spacing:32,rays:1024,bounces:4,adaptiveRays:false}}});
  const out=bakerProfile({version:1},state,'level_01'); assert.equal(out.rays,1024); assert.equal(out.bounces,4); assert.equal(out.adaptive_rays,false); assert.equal(out.environment_probes.resolution,128);
});

test('gltf and glb object mesh names normalize to the renderer object-light key',()=>{
 const manifest={classes:{moby:{'1':{mesh:'mobys/lamp.gltf',name:'lamp'},'2':{mesh:'mobys/weapon.glb',name:'weapon'}}}};
 const rows=placementsFromLevel(manifest,{mobys:[]}); assert.deepEqual(rows,[]);
 const state=normalizeEffects({lights:[{object:'mobys/lamp',type:'point',range:4}]});
 assert.ok(objectLightCatalog(state).objects['mobys/lamp']);
});

test('object-light export validation rejects missing object and zero spot axis',()=>{
 const state=normalizeEffects({lights:[{object:'',type:'point',range:4},{object:'mobys/lamp',type:'spot',direction:[0,0,0],range:5}]});
 const issues=objectLightIssues(state).join('\n'); assert.match(issues,/no object is selected/); assert.match(issues,/spot direction must be non-zero/);
});


test('effects ZIP stores Enhanced object lights at the mod root',async()=>{
  const chunks=[];
  const controller={
    saveStart:async()=> 'token',
    saveWrite:async(_token,bytes)=>chunks.push(new Uint8Array(bytes)),
    saveEnd:async(_token,ok)=>ok?'effects.zip':null,
  };
  const state=normalizeEffects({
    schemaVersion:EFFECTS_SCHEMA_VERSION,
    lights:[{object:'mobys/lamp',type:'point',range:8,intensity:2}],
  });
  const saved=await exportEffectsMod(controller,{game:'rac1',version:'pal',packId:'test'},state,[
    {dir:'level_01',level:1},{dir:'level_02',level:2},
  ]);
  assert.equal(saved,'effects.zip');
  const size=chunks.reduce((n,c)=>n+c.length,0), bytes=new Uint8Array(size);
  let off=0;for(const c of chunks){bytes.set(c,off);off+=c.length}
  const view=new DataView(bytes.buffer), dec=new TextDecoder(), names=[];
  off=0;
  while(off+30<=bytes.length&&view.getUint32(off,true)===0x04034b50){
    const packed=view.getUint32(off+18,true), nameLen=view.getUint16(off+26,true), extra=view.getUint16(off+28,true);
    names.push(dec.decode(bytes.slice(off+30,off+30+nameLen)));
    off+=30+nameLen+extra+packed;
  }
  assert.ok(names.includes('graphics-effects-rac1-pal/assets/level_01/object-lights.json'));
  assert.ok(names.includes('graphics-effects-rac1-pal/assets/level_02/object-lights.json'));
  assert.ok(names.includes('graphics-effects-rac1-pal/graphics-effects.tsv'));
  assert.ok(!names.includes('graphics-effects-rac1-pal/object-lights.json'));
  assert.ok(!names.includes('graphics-effects-rac1-pal/assets/object-lights.json'));
});


test('object-light export refuses a package with no exported level roots',()=>{
  const issues=effectExportIssues(normalizeEffects({
    schemaVersion:EFFECTS_SCHEMA_VERSION,
    lights:[{object:'mobys/lamp',type:'point',range:8}],
  }),[]);
  assert.ok(issues.some(x=>x.includes('at least one exported level')));
});


test('baker export preserves existing area lights and deduplicates authored copies',()=>{
  const existing={position:[9,8,7],axis_u:[1,0,0],axis_v:[0,1,0],radiance:[2,3,4]};
  const state=normalizeEffects({
    schemaVersion:EFFECTS_SCHEMA_VERSION,
    selectedLevel:'level_01',
    areaLights:[
      {level:'level_01',placement:'manual',...existing},
      {level:'level_01',placement:'manual',position:[1,2,3],axis_u:[2,0,0],axis_v:[0,2,0],radiance:[5,4,3]},
    ],
  });
  const base={version:1,area_lights:[existing]};
  const out=bakerProfile(base,state,'level_01');
  assert.equal(out.area_lights.length,2);
  assert.deepEqual(out.area_lights[0],existing);
  assert.deepEqual(mergedAreaLights(out,state,'level_01'),out.area_lights,'re-export must not duplicate authored rectangles');
});

test('area-light limit counts existing Enhanced profile lights too',()=>{
  const existing=Array.from({length:64},(_,i)=>({position:[i,0,0],axis_u:[1,0,0],axis_v:[0,1,0],radiance:[1,1,1]}));
  const state=normalizeEffects({
    schemaVersion:EFFECTS_SCHEMA_VERSION,
    selectedLevel:'level_01',
    areaLights:[{level:'level_01',placement:'manual',position:[999,0,0],axis_u:[1,0,0],axis_v:[0,1,0],radiance:[1,1,1]}],
  });
  assert.ok(bakerExportIssues(state,'level_01',{version:1,area_lights:existing}).some(x=>x.includes('at most 64')));
});


test('missing probe profile uses defaults but malformed existing JSON is not hidden',async()=>{
  const enc=new TextEncoder();
  const missing={read:async()=>{throw new Error('not found')}};
  assert.deepEqual(await readProbeProfile(missing,'level_01'),{});
  const malformed={read:async()=>enc.encode('{broken').buffer};
  await assert.rejects(()=>readProbeProfile(malformed,'level_01'),/invalid JSON/);
  const arrayProfile={read:async()=>enc.encode('[]').buffer};
  await assert.rejects(()=>readProbeProfile(arrayProfile,'level_01'),/must contain a JSON object/);
  const oldVersion={read:async()=>enc.encode('{"version":2}').buffer};
  await assert.rejects(()=>readProbeProfile(oldVersion,'level_01'),/expects version 1/);
});


test('baker export proposes the exact filename the stock launcher baker reads',async()=>{
  const enc=new TextEncoder();
  const calls=[];
  const controller={
    saveStart:async(name,ext)=>{calls.push([name,ext]);return 'token'},
    saveWrite:async()=>{},
    saveEnd:async(_token,ok)=>ok?'probe-bake.json':null,
  };
  const state=normalizeEffects({schemaVersion:EFFECTS_SCHEMA_VERSION,selectedLevel:'level_01'});
  const saved=await exportBakerProfile(controller,{packId:'ignored'},state,'level_01',{version:1});
  assert.equal(saved,'probe-bake.json');
  assert.deepEqual(calls,[['probe-bake','json']]);
});
