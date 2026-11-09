import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeometryJob,
  geometryJobFilename,
  geometryJobIssues,
  normalizeGeometrySettings,
} from '../src/geometry-job.js';

test('geometry job defaults are conservative and OpenRAC-helper compatible',()=>{
  const cfg=normalizeGeometrySettings({});
  assert.equal(cfg.profile,'high');
  assert.equal(cfg.scope,'all');
  assert.equal(cfg.shapeRefine,false);
  assert.equal(cfg.allowCollisionMismatch,false);

  const job=buildGeometryJob({game:'rac1',version:'pal'},cfg);
  assert.equal(job.format,1);
  assert.equal(job.kind,'openrac-graphics-preparation-job');
  assert.equal(job.operation,'ai.meshes');
  assert.equal(job.game,'rac1');
  assert.equal(job.version,'pal');
  assert.deepEqual(job.options,{
    profile:'high',
    scope:'all',
    shape_refine:false,
    allow_collision_mismatch:false,
  });
});

test('geometry settings clamp budgets and expose risky collision choices',()=>{
  const cfg=normalizeGeometrySettings({
    profile:'experimental',
    scope:'terrain',
    shapeRefine:true,
    allowCollisionMismatch:true,
    triangleBudget:9_999_999,
  });
  assert.equal(cfg.triangleBudget,1_000_000);
  const issues=geometryJobIssues({game:'rac1',version:'pal'},cfg);
  assert.ok(issues.some(v=>v.includes('collision')));
  assert.ok(issues.some(v=>v.includes('experimental')));
});

test('geometry job filename is deterministic and sanitized',()=>{
  assert.equal(
    geometryJobFilename({game:'RAC 1',version:'PAL/2.00'},{profile:'ultra'}),
    'geometry-rac-1-pal-2-00-ultra'
  );
});
