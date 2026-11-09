// SPDX-License-Identifier: GPL-3.0-or-later

export const GEOMETRY_JOB_KIND="openrac-graphics-preparation-job";
export const GEOMETRY_PROFILES=Object.freeze(["enhanced","high","ultra","modern","experimental"]);
export const GEOMETRY_SCOPES=Object.freeze(["terrain","scenery","mobys","all"]);
export const GEOMETRY_HEIGHT_SOURCES=Object.freeze(["auto","sidecar","diffuse"]);

export function normalizeGeometrySettings(value={}){
  const profile=GEOMETRY_PROFILES.includes(value.profile)?value.profile:"modern";
  const scope=GEOMETRY_SCOPES.includes(value.scope)?value.scope:"all";
  const heightSource=GEOMETRY_HEIGHT_SOURCES.includes(value.heightSource)?value.heightSource:"auto";
  const crease=Number(value.creaseAngleDegrees);
  const displacement=Number(value.displacementStrength);
  const silhouette=Number(value.silhouetteStrength);
  return {
    profile,
    scope,
    shapeRefine:value.shapeRefine===true,
    allowCollisionMismatch:value.allowCollisionMismatch===true,
    adaptiveSubdivision:value.adaptiveSubdivision!==false,
    assetAwareRemesh:value.assetAwareRemesh!==false,
    topologyOptimize:value.topologyOptimize!==false,
    silhouetteRefine:value.silhouetteRefine!==false,
    silhouetteStrength:Number.isFinite(silhouette)
      ? Math.max(0,Math.min(1.5,silhouette))
      : 1.0,
    lodPlanning:value.lodPlanning!==false,
    microDisplacement:value.microDisplacement===true,
    heightSource,
    displacementStrength:Number.isFinite(displacement)
      ? Math.max(0,Math.min(1.5,displacement))
      : 0.8,
    creaseAngleDegrees:Number.isFinite(crease) && crease>0
      ? Math.max(30,Math.min(120,crease))
      : null,
    triangleBudget:Number.isFinite(Number(value.triangleBudget)) && Number(value.triangleBudget)>0
      ? Math.max(256,Math.min(1_000_000,Math.round(Number(value.triangleBudget))))
      : null,
  };
}

export function modernGeometryPreset(){
  return normalizeGeometrySettings({
    profile:"modern",
    scope:"all",
    shapeRefine:true,
    allowCollisionMismatch:false,
    adaptiveSubdivision:true,
    assetAwareRemesh:true,
    topologyOptimize:true,
    silhouetteRefine:true,
    silhouetteStrength:1.0,
    lodPlanning:true,
    microDisplacement:true,
    heightSource:"auto",
    displacementStrength:0.8,
    creaseAngleDegrees:null,
    triangleBudget:null,
  });
}

export function buildGeometryJob(info,settings={}){
  const cfg=normalizeGeometrySettings(settings);
  const options={
    profile:cfg.profile,
    scope:cfg.scope,
    shape_refine:cfg.shapeRefine,
    allow_collision_mismatch:cfg.allowCollisionMismatch,
    adaptive_subdivision:cfg.adaptiveSubdivision,
    asset_aware_remesh:cfg.assetAwareRemesh,
    topology_optimize:cfg.topologyOptimize,
    silhouette_refine:cfg.silhouetteRefine,
    silhouette_strength:cfg.silhouetteStrength,
    lod_planning:cfg.lodPlanning,
    micro_displacement:cfg.microDisplacement,
    height_source:cfg.heightSource,
    displacement_strength:cfg.displacementStrength,
  };
  if(cfg.triangleBudget!==null)options.triangle_budget=cfg.triangleBudget;
  if(cfg.creaseAngleDegrees!==null)options.crease_angle_degrees=cfg.creaseAngleDegrees;
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
  if(cfg.microDisplacement && cfg.allowCollisionMismatch){
    issues.push("micro-displacement may move terrain/moby surfaces while collision remains original");
  }
  if(cfg.silhouetteRefine && cfg.allowCollisionMismatch){
    issues.push("asset-aware silhouette refinement may move terrain/moby surfaces while collision remains original");
  }
  if(cfg.profile==="experimental"){
    issues.push("experimental profile may need manual geometry/collision review");
  }
  if(!cfg.adaptiveSubdivision && ["ultra","modern","experimental"].includes(cfg.profile)){
    issues.push("uniform subdivision can spend substantially more triangles than adaptive subdivision");
  }
  if(cfg.microDisplacement && cfg.heightSource==="sidecar"){
    issues.push("sidecar-only displacement needs a Graphics preparation pack containing Materials/<hash>/height.png");
  }
  if(cfg.lodPlanning){
    issues.push("stock OpenRAC assets.py imports one replacement GLB; LOD stages are prepared/reported but stock runtime switching is not enabled yet");
  }
  return issues;
}

export function geometryJobFilename(info,settings={}){
  const cfg=normalizeGeometrySettings(settings);
  const game=String(info?.game||"openrac").replace(/[^a-z0-9_-]+/gi,"-").toLowerCase();
  const version=String(info?.version||"version").replace(/[^a-z0-9_-]+/gi,"-").toLowerCase();
  return `geometry-${game}-${version}-${cfg.profile}`;
}
