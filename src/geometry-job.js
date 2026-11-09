// SPDX-License-Identifier: GPL-3.0-or-later

export const GEOMETRY_JOB_KIND="openrac-graphics-preparation-job";
export const GEOMETRY_PROFILES=Object.freeze(["enhanced","high","ultra","experimental"]);
export const GEOMETRY_SCOPES=Object.freeze(["terrain","scenery","mobys","all"]);

export function normalizeGeometrySettings(value={}){
  const profile=GEOMETRY_PROFILES.includes(value.profile)?value.profile:"high";
  const scope=GEOMETRY_SCOPES.includes(value.scope)?value.scope:"all";
  return {
    profile,
    scope,
    shapeRefine:value.shapeRefine===true,
    allowCollisionMismatch:value.allowCollisionMismatch===true,
    triangleBudget:Number.isFinite(Number(value.triangleBudget)) && Number(value.triangleBudget)>0
      ? Math.max(256,Math.min(1_000_000,Math.round(Number(value.triangleBudget))))
      : null,
  };
}

export function buildGeometryJob(info,settings={}){
  const cfg=normalizeGeometrySettings(settings);
  const options={
    profile:cfg.profile,
    scope:cfg.scope,
    shape_refine:cfg.shapeRefine,
    allow_collision_mismatch:cfg.allowCollisionMismatch,
  };
  if(cfg.triangleBudget!==null)options.triangle_budget=cfg.triangleBudget;
  return {
    format:1,
    kind:GEOMETRY_JOB_KIND,
    operation:"ai.meshes",
    game:String(info?.game||""),
    version:String(info?.version||""),
    options,
  };
}

export function geometryJobIssues(info,settings={}){
  const cfg=normalizeGeometrySettings(settings);
  const issues=[];
  if(!info?.game)issues.push("game is unavailable");
  if(!info?.version)issues.push("game version is unavailable");
  if(cfg.shapeRefine && cfg.allowCollisionMismatch){
    issues.push("shape refinement may move terrain/moby vertices while collision remains original");
  }
  if(cfg.profile==="experimental"){
    issues.push("experimental profile may need manual geometry/collision review");
  }
  return issues;
}

export function geometryJobFilename(info,settings={}){
  const cfg=normalizeGeometrySettings(settings);
  const game=String(info?.game||"openrac").replace(/[^a-z0-9_-]+/gi,"-").toLowerCase();
  const version=String(info?.version||"version").replace(/[^a-z0-9_-]+/gi,"-").toLowerCase();
  return `geometry-${game}-${version}-${cfg.profile}`;
}
