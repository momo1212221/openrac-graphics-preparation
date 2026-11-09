// SPDX-License-Identifier: GPL-3.0-or-later
import {modernGeometryPreset} from "./geometry-job.js";

export function modernGraphicsPreset(current={}){
  const geometry=modernGeometryPreset();
  return {
    ...current,
    aiMode:"enhanced",
    preserveMicrodetail:true,
    preserveStars:true,
    detailQuality:"auto",
    detailCnn:true,
    sourceColorLock:true,
    qualityGuard:true,
    master8x:true,
    persistentCache:true,
    materialMaps:"key",
    materialCurvature:true,
    mipmaps:"key",
    geometryProfile:geometry.profile,
    geometryScope:geometry.scope,
    geometryShapeRefine:geometry.shapeRefine,
    geometryAllowCollisionMismatch:geometry.allowCollisionMismatch,
    geometryAdaptiveSubdivision:geometry.adaptiveSubdivision,
    geometryMicroDisplacement:geometry.microDisplacement,
    geometryHeightSource:geometry.heightSource,
    geometryDisplacementStrength:geometry.displacementStrength,
    geometryCreaseAngle:geometry.creaseAngleDegrees||0,
    geometryTriangleBudget:geometry.triangleBudget||0,
  };
}
