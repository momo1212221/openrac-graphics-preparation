// SPDX-License-Identifier: GPL-3.0-or-later
// Optional offline pipeline entrypoint; this module does not load ONNX models.
import {predictEmissiveProbabilities} from './emissive-onnx-adapter.js';
import {fuseEmissivePrediction} from './emissive-cnn-fusion.js';

/**
 * Prepares an emissive sidecar after the current rule-based generation step.
 * enabled=false: bit-exact fallback, no ONNX call and no change to cache identity.
 * ONNX inference failures: do not damage existing output; surface a QA warning.
 * The caller owns model loading/signature verification and any result caching.
 */
export async function prepareOfflineEmissive({
  source, heuristic, material='generic', enabled=false,
  ort=null, session=null, modelSha256=null,
  mode='augment', confidence=0.94, allowGreenEmission=false,
  outputEncoding='probability', onProgress=()=>{}, shouldCancel=()=>false,
} = {}) {
  const base = {source,heuristic,material,mode,confidence,allowGreenEmission,modelSha256};
  if (!enabled) return fuseEmissivePrediction(base);
  try {
    const prediction = await predictEmissiveProbabilities({
      image:source,ort,session,outputEncoding,onProgress,shouldCancel,
    });
    return fuseEmissivePrediction({...base,prediction});
  } catch (error) {
    const fallback = fuseEmissivePrediction(base);
    return {
      ...fallback,
      report: {
        ...fallback.report,
        status: 'inference-fallback',
        warning: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
