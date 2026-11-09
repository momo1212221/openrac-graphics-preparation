import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeometryJob,
  geometryJobFilename,
  geometryJobIssues,
  modernGeometryPreset,
  normalizeGeometrySettings,
} from '../src/geometry-job.js';

test('geometry job defaults use the modern adaptive target safely',()=>{
  const cfg=normalizeGeometrySettings({});
  assert.equal(cfg.profile,'modern');
  assert.equal(cfg.scope,'all');
  assert.equal(cfg.shapeRefine,false);
  assert.equal(cfg.allowCollisionMismatch,false);
  assert.equal(cfg.adaptiveSubdivision,true);
  assert.equal(cfg.assetAwareRemesh,true);
  assert.equal(cfg.topologyOptimize,true);
  assert.equal(cfg.silhouetteRefine,true);
  assert.equal(cfg.silhouetteStrength,1.0);
  assert.equal(cfg.lodPlanning,true);
  assert.equal(cfg.microDisplacement,false);
  assert.equal(cfg.heightSource,'auto');
  assert.equal(cfg.displacementStrength,0.8);
  assert.equal(cfg.creaseAngleDegrees,null);

  const job=buildGeometryJob({game:'rac1',version:'pal'},cfg);
  assert.equal(job.format,1);
  assert.equal(job.kind,'openrac-graphics-preparation-job');
  assert.equal(job.operation,'ai.meshes');
  assert.equal(job.game,'rac1');
  assert.equal(job.version,'pal');
  assert.deepEqual(job.options,{
    profile:'modern',
    scope:'all',
    shape_refine:false,
    allow_collision_mismatch:false,
    adaptive_subdivision:true,
    asset_aware_remesh:true,
    topology_optimize:true,
    silhouette_refine:true,
    silhouette_strength:1,
    lod_planning:true,
    micro_displacement:false,
    height_source:'auto',
    displacement_strength:0.8,
  });
});

test('modern PS5-target preset turns on safe static shape refinement',()=>{
  const cfg=modernGeometryPreset();
  assert.equal(cfg.profile,'modern');
  assert.equal(cfg.scope,'all');
  assert.equal(cfg.shapeRefine,true);
  assert.equal(cfg.allowCollisionMismatch,false);
  assert.equal(cfg.adaptiveSubdivision,true);
  assert.equal(cfg.assetAwareRemesh,true);
  assert.equal(cfg.topologyOptimize,true);
  assert.equal(cfg.silhouetteRefine,true);
  assert.equal(cfg.silhouetteStrength,1.0);
  assert.equal(cfg.lodPlanning,true);
  assert.equal(cfg.microDisplacement,true);
  assert.equal(cfg.heightSource,'auto');
  assert.equal(cfg.displacementStrength,0.8);
  assert.equal(cfg.triangleBudget,null);
  assert.equal(cfg.creaseAngleDegrees,null);
});

test('geometry settings clamp budgets and crease angle and expose risky collision choices',()=>{
  const cfg=normalizeGeometrySettings({
    profile:'experimental',
    scope:'terrain',
    shapeRefine:true,
    allowCollisionMismatch:true,
    adaptiveSubdivision:false,
    assetAwareRemesh:true,
    topologyOptimize:true,
    silhouetteRefine:true,
    silhouetteStrength:99,
    lodPlanning:true,
    microDisplacement:true,
    heightSource:'sidecar',
    displacementStrength:99,
    creaseAngleDegrees:500,
    triangleBudget:9_999_999,
  });
  assert.equal(cfg.triangleBudget,1_000_000);
  assert.equal(cfg.creaseAngleDegrees,120);
  assert.equal(cfg.adaptiveSubdivision,false);
  assert.equal(cfg.assetAwareRemesh,true);
  assert.equal(cfg.topologyOptimize,true);
  assert.equal(cfg.silhouetteRefine,true);
  assert.equal(cfg.silhouetteStrength,1.5);
  assert.equal(cfg.lodPlanning,true);
  assert.equal(cfg.microDisplacement,true);
  assert.equal(cfg.heightSource,'sidecar');
  assert.equal(cfg.displacementStrength,1.5);
  const issues=geometryJobIssues({game:'rac1',version:'pal'},cfg);
  assert.ok(issues.some(v=>v.includes('collision')));
  assert.ok(issues.some(v=>v.includes('experimental')));
  assert.ok(issues.some(v=>v.includes('uniform subdivision')));
  assert.ok(issues.some(v=>v.includes('height.png')));
  assert.ok(issues.some(v=>v.includes('replacement GLB')));
});

test('geometry job filename is deterministic and sanitized',()=>{
  assert.equal(
    geometryJobFilename({game:'RAC 1',version:'PAL/2.00'},{profile:'ultra'}),
    'geometry-rac-1-pal-2-00-ultra'
  );
});
