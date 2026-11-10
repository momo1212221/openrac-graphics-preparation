// SPDX-License-Identifier: GPL-3.0-or-later
// Offline CNN emission-mask fusion for Graphics Preparation.
// No model download, disk/cache mutations, or GPU calls: prediction is injected.
export const EMISSIVE_CNN_FUSION_VERSION = 1;

const MAX_PIXELS = 64 * 1024 * 1024;
const DEFAULT_CONFIDENCE = 0.94;
const LOW_CONFIDENCE_SUPPRESS = 0.12;
const GATE_MATERIALS = new Set(['generic', 'terrain', 'organic', 'fabric', 'stone']);
const CHROMA_MATERIALS = new Set(['generic', 'metal', 'weapon', 'character', 'energy']);

function imageIsValid(image) {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)) return false;
  if (image.width <= 0 || image.height <= 0 || image.width > 16384 || image.height > 16384) return false;
  const pixels = image.width * image.height;
  return pixels <= MAX_PIXELS &&
    (image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) &&
    image.data.length === pixels * 4;
}

function countEmissive(image) {
  let n = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i] || image.data[i + 1] || image.data[i + 2]) n++;
  }
  return n;
}

function clone(image) {
  return {width:image.width, height:image.height, data:new Uint8ClampedArray(image.data)};
}

function validPrediction(mask, width, height) {
  if (!mask || mask.width !== width || mask.height !== height ||
      !(mask.probabilities instanceof Float32Array || mask.probabilities instanceof Float64Array) ||
      mask.probabilities.length !== width * height) return false;
  // Fail closed: one NaN/Infinity/out-of-range entry invalidates the complete output.
  for (const p of mask.probabilities) if (!Number.isFinite(p) || p < 0 || p > 1) return false;
  return true;
}

/**
 * Refine an existing rule-generated emissive PNG from *offline* CNN probabilities.
 * A caller may supply a verified ONNX mask or a local, experimental CNN mask.
 * Mask format: {width,height,probabilities: Float32Array}, values 0..1, pixel aligned.
 *
 * mode="augment" (default): preserve all historical emissive pixels, add only confidently
 *    predicted bright emitters. This is safe for existing saved graphics packs.
 * mode="verify" (experimental): for foliage-like material families, remove *heuristic*
 *    emission when CNN probability is very low, while adding high-confidence candidates.
 *
 * In both modes: skip transparent pixels, reject greens on non-energy materials by default,
 * keep the source RGB hue, and never touch the caller's buffers.
 */
export function fuseEmissivePrediction({
  source, heuristic, prediction = null, material = 'generic', mode = 'augment',
  confidence = DEFAULT_CONFIDENCE, allowGreenEmission = false, modelSha256 = null,
} = {}) {
  if (!imageIsValid(source) || !imageIsValid(heuristic)) {
    throw new TypeError('source and heuristic must be matching RGBA8 images');
  }
  if (source.width !== heuristic.width || source.height !== heuristic.height) {
    throw new RangeError('emissive map must match the source texture dimensions');
  }
  if (!['augment', 'verify'].includes(mode) || !Number.isFinite(confidence) ||
      confidence < 0.5 || confidence >= 1) {
    throw new RangeError('invalid emissive fusion mode or confidence');
  }
  if (modelSha256 !== null && !/^[0-9a-f]{64}$/i.test(String(modelSha256))) {
    throw new TypeError('modelSha256 must contain a complete 64-character SHA-256 digest');
  }
  const emissive = clone(heuristic);
  const report = {
    version:EMISSIVE_CNN_FUSION_VERSION, mode,
    status:'no-prediction', modelSha256, threshold:confidence,
    promotedPixels:0, suppressedPixels:0, greenRejectedPixels:0,
    brightRejectedPixels:0, transparentPixels:0,
    chromaPromotedPixels:0, chromaDensity:0,
  };
  if (!prediction) return {emissive, emissivePixels:countEmissive(emissive), report};
  if (!validPrediction(prediction, source.width, source.height)) {
    report.status = 'invalid-prediction';
    return {emissive, emissivePixels:countEmissive(emissive), report};
  }
  report.status = 'applied';
  const p = prediction.probabilities;
  const src = source.data;
  const out = emissive.data;
  const family = String(material).toLowerCase();

  // High-confidence saturated red/blue emission has low REC.709 luminance.
  // A luminance-only gate rejected red weapon lamps and blue energy cores even
  // after the CNN recognised them. Permit such masks only if the bright, vivid
  // region is localised in this *material*, rather than covering a whole
  // painted wall. Never do this for vegetation, stone, soil or textiles.
  const chromaMinConfidence = Math.max(0.92, confidence);
  let vividCandidates = 0, opaquePixels = 0;
  if (CHROMA_MATERIALS.has(family)) {
    for (let pixel = 0; pixel < p.length; pixel++) {
      const i = pixel * 4;
      if (src[i + 3] < 16) continue;
      opaquePixels++;
      const maxRB = Math.max(src[i], src[i + 2]);
      if (maxRB >= 220 && src[i + 1] < maxRB * 0.65
          && p[pixel] >= chromaMinConfidence) vividCandidates++;
    }
  }
  const chromaDensity = opaquePixels ? vividCandidates / opaquePixels : 0;
  report.chromaDensity = Math.round(chromaDensity * 10000) / 10000;
  const localisedChroma = vividCandidates > 0 && chromaDensity <= 0.27;
  for (let pixel = 0; pixel < p.length; pixel++) {
    const i = pixel * 4;
    const a = src[i + 3];
    out[i + 3] = a;
    if (a < 16) {
      // Historical deriveEmissiveFromSource already zeroed these pixels.
      out[i] = out[i + 1] = out[i + 2] = 0;
      report.transparentPixels++;
      continue;
    }
    if (mode === 'verify' && GATE_MATERIALS.has(family) && p[pixel] < LOW_CONFIDENCE_SUPPRESS) {
      if (out[i] || out[i + 1] || out[i + 2]) report.suppressedPixels++;
      out[i] = out[i + 1] = out[i + 2] = 0;
    }
    if (p[pixel] < confidence) continue;
    const r = src[i], g = src[i + 1], b = src[i + 2];
    const peak = Math.max(r, g, b) / 255;
    const y = (0.2126*r + 0.7152*g + 0.0722*b) / 255;
    const vividRB = Math.max(r, b) >= 220 && g < Math.max(r, b) * 0.65;
    const chromaEmitter = localisedChroma && vividRB && peak >= 0.85
      && p[pixel] >= chromaMinConfidence;
    if (peak < 0.72 || (y < 0.48 && !(family === 'energy' && peak >= 0.85)
        && !chromaEmitter)) {
      report.brightRejectedPixels++;
      continue;
    }
    // Prevent saturated green foliage blooming. For a verified green LED, callers
    // must explicitly classify as energy or supply allowGreenEmission after QA.
    const greenDominant = g > r * 1.35 && g > b * 1.35 && g > 125;
    if (greenDominant && family !== 'energy' && !allowGreenEmission) {
      report.greenRejectedPixels++;
      continue;
    }
    const score = Math.min(1, (p[pixel] - confidence) / (1 - confidence));
    const alpha = a / 255;
    const gain = score * alpha * (0.6 + 0.4*peak);
    const old = [out[i], out[i+1], out[i+2]];
    for (let c = 0; c < 3; c++) {
      out[i + c] = Math.max(out[i + c], Math.min(255, Math.round(src[i + c] * gain)));
    }
    if (old.some((v,c) => v !== out[i+c])) {
      report.promotedPixels++;
      if (chromaEmitter) report.chromaPromotedPixels++;
    }
  }
  return {emissive, emissivePixels:countEmissive(emissive), report};
}
