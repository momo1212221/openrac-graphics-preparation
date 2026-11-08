import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deriveMaterialMaps,shouldGenerateMaterialMaps} from '../src/material-maps.js';
import {validateMaterialMaps} from '../src/material-map-quality.js';

const image=(w,h,fn)=>{
 const data=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(fn(x,y),(y*w+x)*4);
 return {width:w,height:h,data};
};

test('derived maps keep dimensions and valid tangent normals',()=>{
 const src=image(5,5,(x,y)=>[80+x*20,70+y*15,60,255]);
 const maps=deriveMaterialMaps(src,'stone');
 for(const name of ['albedo','normal','roughness','height','ao','emissive','specular','metallic','cavity','curvature','edgewear']){
   assert.equal(maps[name].width,5);assert.equal(maps[name].height,5);
   assert.equal(maps[name].data.length,5*5*4);
 }
 const i=(2*5+2)*4;
 const nx=maps.normal.data[i]/127.5-1,ny=maps.normal.data[i+1]/127.5-1,nz=maps.normal.data[i+2]/127.5-1;
 assert.ok(Math.abs(Math.hypot(nx,ny,nz)-1)<.03);
});

test('energy material extracts emissive pixels while dark generic remains non-emissive',()=>{
 const bright=image(2,2,()=>[250,80,20,255]);
 const dark=image(2,2,()=>[30,25,20,255]);
 assert.ok(deriveMaterialMaps(bright,'energy').emissivePixels>0);
 assert.equal(deriveMaterialMaps(dark,'generic').emissivePixels,0);
});

test('material map generation policy stays off for current stock launcher by default',()=>{
 assert.equal(shouldGenerateMaterialMaps('diffuse','stone','off'),false);
 assert.equal(shouldGenerateMaterialMaps('diffuse','stone','key'),true);
 assert.equal(shouldGenerateMaterialMaps('ui','generic','all'),false);
});

test('metal and weapon materials produce stronger metallic/specular priors',()=>{
 const src=image(3,3,()=>[120,120,125,255]);
 const metal=deriveMaterialMaps(src,'metal'),generic=deriveMaterialMaps(src,'generic');
 assert.ok(metal.metallic.data[0]>generic.metallic.data[0]);
 assert.ok(metal.specular.data[0]>generic.specular.data[0]);
});


test('generated material maps pass tangent/scalar validation',()=>{
 const src=image(8,8,(x,y)=>[70+x*8,65+y*7,60+(x+y)%3,255]);
 const maps=deriveMaterialMaps(src,'stone');
 const q=validateMaterialMaps(maps);
 assert.equal(q.ok,true);
 assert.ok(q.meanNormalLengthError<.04);
 assert.equal(q.backwardNormalPercent,0);
 assert.ok(Number.isFinite(q.worstSeam));
 assert.ok(q.scalarStats.roughness.min>=.035);
});

test('material validation rejects invalid tangent normals and non-scalar roughness',()=>{
 const src=image(3,3,()=>[100,100,100,255]);
 const maps=deriveMaterialMaps(src,'generic');
 maps.normal.data.set([255,255,0,255],0);
 maps.roughness.data.set([0,100,200,255],0);
 const q=validateMaterialMaps(maps);
 assert.equal(q.ok,false);
 assert.ok(q.issues.includes('normal-facing')||q.issues.includes('normal-length'));
 assert.ok(q.issues.includes('roughness-not-scalar'));
});


test('material map derivation includes PBR calibration',()=>{
 const src=image(8,8,(x,y)=>[90+x*4,92+y*3,95,255]);
 const stone=deriveMaterialMaps(src,'stone');
 assert.equal(stone.pbrValidation.ok,true);
 assert.ok(stone.pbrCalibration.meanMetallic<=.04);
 assert.ok(stone.pbrCalibration.meanRoughness>=.5);
 const metal=deriveMaterialMaps(src,'metal');
 assert.equal(metal.pbrValidation.ok,true);
 assert.ok(metal.pbrCalibration.meanMetallic>=.7);
});


test('material maps include conservative lighting-neutralized albedo',()=>{
 const src=image(32,16,(x)=>x<16?[65,60,55,255]:[150,140,130,255]);
 const maps=deriveMaterialMaps(src,'stone');
 assert.equal(maps.albedo.width,32);
 assert.equal(maps.albedo.height,16);
 assert.equal(maps.albedoValidation.ok,true);
 assert.ok(maps.albedoDelight.adjustedPixels>0);
});


test('multi-scale height is derived from de-lit albedo and reports reconstruction metadata',()=>{
 const src=image(48,24,(x)=>x<24?[65,60,55,255]:[155,145,135,255]);
 const maps=deriveMaterialMaps(src,'stone');
 assert.equal(maps.heightPipeline.order[1],'albedo-cleanup');
 assert.equal(maps.heightPipeline.order[2],'coarse-height');
 assert.equal(maps.heightPipeline.order[3],'mid-height');
 assert.equal(maps.heightPipeline.order[4],'micro-height');
 assert.ok(maps.heightPipeline.profile.normalStrength>=4);
 assert.ok(maps.heightPipeline.merged.reliefRange>=0);

 // Absolute brightness is not absolute geometry: away from the illumination boundary both
 // broad regions should remain close to neutral height.
 const sample=(x,y)=>maps.height.data[(y*48+x)*4]/255;
 assert.ok(Math.abs(sample(8,12)-.5)<.08);
 assert.ok(Math.abs(sample(39,12)-.5)<.08);
});

test('stone produces more pronounced reconstructed normals than character for the same crack pattern',()=>{
 const src=image(40,40,(x,y)=>{
   const crack=(x===19||x===20||y===27);
   const v=crack?45:125+((x+y)%5)*5;
   return [v,v,v,255];
 });
 const stone=deriveMaterialMaps(src,'stone');
 const character=deriveMaterialMaps(src,'character');
 const normalDeviation=(maps)=>{
   let sum=0,n=0;
   for(let i=0;i<maps.normal.data.length;i+=4){
     if(maps.normal.data[i+3]<16)continue;
     const nx=maps.normal.data[i]/127.5-1;
     const ny=maps.normal.data[i+1]/127.5-1;
     sum+=Math.hypot(nx,ny);n++;
   }
   return sum/Math.max(1,n);
 };
 assert.ok(normalDeviation(stone)>normalDeviation(character)*1.25);
});

test('height, AO and cavity use reconstructed relative geometry rather than raw darkness',()=>{
 const src=image(32,32,(x,y)=>{
   const v=x<16?70:150;
   const crack=(x===8&&y>6&&y<26)?-35:0;
   return [Math.max(0,v+crack),Math.max(0,v+crack),Math.max(0,v+crack),255];
 });
 const maps=deriveMaterialMaps(src,'stone');
 const flatDark=(16*32+3)*4;
 const crack=(16*32+8)*4;
 assert.ok(maps.cavity.data[crack]>maps.cavity.data[flatDark]);
 assert.ok(maps.ao.data[crack]<maps.ao.data[flatDark]);
});


test('production material pipeline records the requested stage order',()=>{
 const src=image(16,16,(x,y)=>[90+x*4,85+y*3,80+(x+y)%4,255]);
 const maps=deriveMaterialMaps(src,'stone');
 assert.deepEqual(maps.heightPipeline.order,[
   'upscaled-diffuse','albedo-cleanup','coarse-height','mid-height','micro-height',
   'height-merge','normal-from-height','ao-roughness','curvature'
 ]);
 assert.ok(maps.coarseHeight&&maps.midHeight&&maps.microHeight);
 assert.equal(maps.heightPipeline.curvatureEnabled,true);
});

test('curvature can be disabled while required material sidecars remain available',()=>{
 const src=image(10,10,(x,y)=>[100+x*3,95+y*2,90,255]);
 const maps=deriveMaterialMaps(src,'metal',{curvature:false});
 assert.equal(maps.curvature,undefined);
 assert.equal(maps.heightPipeline.curvatureEnabled,false);
 assert.ok(maps.height&&maps.normal&&maps.ao&&maps.roughness);
 assert.equal(maps.pbrValidation.ok,true);
});


test('weapon emissive regions are detected before albedo cleanup and remain protected',()=>{
 const src=image(32,12,(x)=>x<16?[55,50,45,255]:[250,80,20,255]);
 const maps=deriveMaterialMaps(src,'weapon');
 assert.ok(maps.emissivePixels>0);
 const i=(6*32+24)*4;
 const source=[250,80,20];
 const delta=(
   Math.abs(maps.albedo.data[i]-source[0])+
   Math.abs(maps.albedo.data[i+1]-source[1])+
   Math.abs(maps.albedo.data[i+2]-source[2])
 )/3;
 assert.ok(delta<20);
});


test('production height pipeline validation rejects metadata drift',()=>{
 const src=image(12,12,(x,y)=>[85+x*4,82+y*3,78+(x+y)%3,255]);
 const maps=deriveMaterialMaps(src,'stone');
 let quality=validateMaterialMaps(maps);
 assert.equal(quality.heightPipelineValidation.ok,true);
 assert.equal(quality.heightPipelineValidation.version,2);

 maps.heightPipeline={...maps.heightPipeline,version:1};
 quality=validateMaterialMaps(maps);
 assert.equal(quality.ok,false);
 assert.ok(quality.issues.includes('height-pipeline-version'));

 maps.heightPipeline={...maps.heightPipeline,version:2,order:['upscaled-diffuse','height-merge']};
 quality=validateMaterialMaps(maps);
 assert.ok(quality.issues.includes('height-pipeline-order'));
});

test('curvature metadata must match the actual optional sidecar',()=>{
 const src=image(10,10,(x,y)=>[100+x*2,94+y*2,88,255]);
 const maps=deriveMaterialMaps(src,'metal',{curvature:false});
 let quality=validateMaterialMaps(maps);
 assert.equal(quality.heightPipelineValidation.ok,true);
 maps.heightPipeline={...maps.heightPipeline,curvatureEnabled:true};
 quality=validateMaterialMaps(maps);
 assert.ok(quality.issues.includes('curvature-stage-mismatch'));
});


test('material QA exposes normal tilt and height relief metrics',()=>{
 const src=image(32,32,(x,y)=>{
   const v=(x===15||y===19)?45:120+((x+y)%6)*6;
   return [v,v,v,255];
 });
 const maps=deriveMaterialMaps(src,'stone');
 const q=validateMaterialMaps(maps);
 assert.ok(Number.isFinite(q.normalTilt.meanDeg));
 assert.ok(Number.isFinite(q.normalTilt.p95Deg));
 assert.ok(q.normalTilt.p95Deg>=q.normalTilt.meanDeg);
 assert.ok(q.heightRelief&&q.heightRelief.range>=0);
 assert.ok(Array.isArray(q.reliefWarnings));
});

test('height pipeline exports explicit parallax authoring metadata without claiming stock renderer support',()=>{
 const src=image(32,32,(x,y)=>{
   const v=100+((x*7+y*5)%48);
   return [v,v,v,255];
 });
 const stone=deriveMaterialMaps(src,'stone');
 assert.equal(stone.heightPipeline.parallaxAuthoring.source,'height.png');
 assert.equal(stone.heightPipeline.parallaxAuthoring.encoding,'relative-height-0.5-neutral');
 assert.equal(stone.heightPipeline.parallaxAuthoring.neutralHeight,.5);
 assert.equal(stone.heightPipeline.parallaxAuthoring.rendererSupportRequired,true);
 assert.ok(stone.heightPipeline.parallaxAuthoring.recommendedScale>0);
 assert.equal(stone.heightPipeline.parallaxAuthoring.ready,true);

 const sky=deriveMaterialMaps(src,'sky');
 assert.equal(sky.heightPipeline.parallaxAuthoring.recommendedScale,0);
 assert.equal(sky.heightPipeline.parallaxAuthoring.ready,false);
});
