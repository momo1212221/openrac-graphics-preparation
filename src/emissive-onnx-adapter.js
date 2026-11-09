// SPDX-License-Identifier: GPL-3.0-or-later
// Offline full-resolution emissive CNN inference adapter (no model or runtime bundled).
// Contract: ONNX RGB [1,3,128,128] input, one-channel [1,1,128,128] output.
// The model must be trained with the same sRGB 0..1 input preprocessing.
export const EMISSIVE_ONNX_TILE = 128;
export const EMISSIVE_ONNX_CONTEXT = 16;

const bounded = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function validImage(image) {
  const w = image?.width, h = image?.height;
  return Number.isSafeInteger(w) && Number.isSafeInteger(h) && w > 0 && h > 0 &&
    w <= 16384 && h <= 16384 && w*h <= 64*1024*1024 &&
    (image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) &&
    image.data.length === w*h*4;
}

/**
 * Runs a caller-supplied ONNX session with bounded per-tile memory.
 * session: ONNX Runtime InferenceSession or compatible fake used in tests.
 * ort: ONNX Runtime namespace providing new ort.Tensor('float32', values, dims).
 * outputEncoding: 'probability' or 'logit' (must match the trained model contract).
 * No downloads, retained sessions, global WebGPU state, or writes to the AI upscale cache.
 */
export async function predictEmissiveProbabilities({
  image, ort, session, outputEncoding='probability', onProgress=()=>{}, shouldCancel=()=>false,
} = {}) {
  if (!validImage(image)) throw new TypeError('image must be a valid RGBA8 texture');
  if (!ort || typeof ort.Tensor !== 'function' || !session || typeof session.run !== 'function') {
    throw new TypeError('an initialized ONNX Runtime session and Tensor constructor are required');
  }
  if (!['probability','logit'].includes(outputEncoding)) throw new RangeError('unsupported output encoding');
  const inputName = session.inputNames?.[0], outputName = session.outputNames?.[0];
  if (typeof inputName !== 'string' || typeof outputName !== 'string') {
    throw new TypeError('ONNX session must supply named inputs and outputs');
  }
  const {width, height, data} = image;
  const tile = EMISSIVE_ONNX_TILE, pad = EMISSIVE_ONNX_CONTEXT;
  const core = tile - pad*2;
  const columns = Math.ceil(width/core), rows = Math.ceil(height/core), total = columns*rows;
  const probabilities = new Float32Array(width*height);
  let done = 0;
  for (let y0=0;y0<height;y0+=core) {
    for (let x0=0;x0<width;x0+=core) {
      if (shouldCancel()) throw new Error('emissive CNN inference cancelled');
      const input = new Float32Array(3*tile*tile);
      for (let sy=0;sy<tile;sy++) {
        const y=bounded(y0+sy-pad,0,height-1);
        for (let sx=0;sx<tile;sx++) {
          const x=bounded(x0+sx-pad,0,width-1);
          const index=(y*width+x)*4;
          const pixel=sy*tile+sx;
          // Transparent source texels must never contribute artificial RGB structure.
          if (data[index+3] < 16) continue;
          for (let c=0;c<3;c++) input[c*tile*tile+pixel] = data[index+c]/255;
        }
      }
      const tensor = new ort.Tensor('float32', input, [1,3,tile,tile]);
      const result = await session.run({[inputName]:tensor});
      const output = result?.[outputName];
      if (!output || output.dims?.length !== 4 || output.dims[0] !== 1 ||
          output.dims[1] !== 1 || output.dims[2] !== tile || output.dims[3] !== tile ||
          output.data?.length !== tile*tile) {
        throw new Error('emissive CNN returned an incompatible output shape; expected [1,1,128,128]');
      }
      // Write only the context-free central 96x96 pixels. No partially composed result is
      // returned on inference errors; upstream keeps its rule-generated emissive map.
      for (let cy=0;cy<core&&y0+cy<height;cy++) {
        for (let cx=0;cx<core&&x0+cx<width;cx++) {
          const sourceIndex=(cy+pad)*tile+(cx+pad);
          const raw=Number(output.data[sourceIndex]);
          if (!Number.isFinite(raw)) throw new Error('emissive CNN returned a nonfinite probability');
          const probability=outputEncoding==='logit'
            ? 1/(1+Math.exp(-bounded(raw,-50,50)))
            : raw;
          if (!Number.isFinite(probability) || probability<0 || probability>1) {
            throw new Error('emissive CNN returned a probability outside 0..1');
          }
          probabilities[(y0+cy)*width+x0+cx] = image.data[((y0+cy)*width+x0+cx)*4+3] < 16
            ? 0 : probability;
        }
      }
      done++;
      onProgress({done,total});
    }
  }
  return {width,height,probabilities};
}
