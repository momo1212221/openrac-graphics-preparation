// SPDX-License-Identifier: GPL-3.0-or-later
export const MODEL_INPUT = 128;
export const SCALE = 4;

export const TILE_QUALITY = Object.freeze({
  standard: Object.freeze({name:"standard", pad:8, core:112, overlap:0, step:112}),
  high: Object.freeze({name:"high", pad:16, core:96, overlap:8, step:88}),
  max: Object.freeze({name:"max", pad:24, core:80, overlap:16, step:64}),
});

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const coordinate=(value,size,wrap)=>{
  if(!wrap)return clamp(value,0,size-1);
  return ((value%size)+size)%size;
};

export function tileGeometry(quality = "high", textureClass = "diffuse") {
  // UI should keep the established look instead of inventing extra structure.
  if (textureClass === "ui" || textureClass === "normal" || textureClass === "mask") {
    return TILE_QUALITY.standard;
  }
  return TILE_QUALITY[quality] || TILE_QUALITY.high;
}

/**
 * Fill a reusable fixed-size RGB tensor input for the pinned Real-ESRGAN model.
 * Padding is quality-dependent but the ONNX input remains exactly 128x128.
 */
export function fillFixedRgbTile(sourceData, sourceX, sourceY, values, pad = 8, wrap = {x:false,y:false}) {
  const {width, height, data} = sourceData;
  if (!width || !height) throw new Error("empty source texture");
  const plane = MODEL_INPUT * MODEL_INPUT;
  if (!(values instanceof Float32Array) || values.length !== plane * 3) {
    throw new TypeError(`tile buffer must be Float32Array(${plane * 3})`);
  }
  if (!Number.isInteger(pad) || pad < 0 || pad * 2 >= MODEL_INPUT) {
    throw new RangeError("invalid tile padding");
  }

  for (let ty = 0; ty < MODEL_INPUT; ty++) {
    const sy = coordinate(sourceY - pad + ty, height, wrap.y === true);
    for (let tx = 0; tx < MODEL_INPUT; tx++) {
      const sx = coordinate(sourceX - pad + tx, width, wrap.x === true);
      const sourceAt = (sy * width + sx) * 4;
      const tileAt = ty * MODEL_INPUT + tx;
      values[tileAt] = data[sourceAt] / 255;
      values[plane + tileAt] = data[sourceAt + 1] / 255;
      values[plane * 2 + tileAt] = data[sourceAt + 2] / 255;
    }
  }
  return values;
}

export function fixedRgbTile(sourceData, sourceX, sourceY, pad = 8, wrap = {x:false,y:false}) {
  return fillFixedRgbTile(
    sourceData,
    sourceX,
    sourceY,
    new Float32Array(3 * MODEL_INPUT * MODEL_INPUT),
    pad,
    wrap,
  );
}

function featherWeight(position, size, feather, hasBefore, hasAfter) {
  if (feather <= 0) return 255;
  let weight = 1;
  if (hasBefore && position < feather) weight = Math.min(weight, (position + 1) / (feather + 1));
  if (hasAfter && position >= size - feather) {
    weight = Math.min(weight, (size - position) / (feather + 1));
  }
  return Math.max(1, Math.round(weight * 255));
}

/**
 * Incrementally blends an overlapping 4x tile into one output ImageData. Only one Uint16 weight
 * plane is needed, avoiding huge float accumulation buffers.
 */
export function blendTile(output, weights, tile, destX, destY, {
  overlap = 0,
  sourceX = 0,
  sourceY = 0,
  sourceWidth,
  sourceHeight,
  coreW,
  coreH,
} = {}) {
  const feather = overlap * SCALE;
  const hasLeft = sourceX > 0;
  const hasTop = sourceY > 0;
  const hasRight = sourceX + coreW < sourceWidth;
  const hasBottom = sourceY + coreH < sourceHeight;
  const tw = tile.width, th = tile.height;

  for (let y = 0; y < th; y++) {
    const wy = featherWeight(y, th, feather, hasTop, hasBottom);
    const oy = destY + y;
    if (oy < 0 || oy >= output.height) continue;
    for (let x = 0; x < tw; x++) {
      const ox = destX + x;
      if (ox < 0 || ox >= output.width) continue;
      const wx = featherWeight(x, tw, feather, hasLeft, hasRight);
      const w = Math.min(wx, wy);
      const outPixel = oy * output.width + ox;
      const oldWeight = weights[outPixel];
      const nextWeight = Math.min(65535, oldWeight + w);
      const oi = outPixel * 4;
      const ti = (y * tw + x) * 4;

      if (oldWeight === 0) {
        output.data[oi] = tile.data[ti];
        output.data[oi + 1] = tile.data[ti + 1];
        output.data[oi + 2] = tile.data[ti + 2];
        output.data[oi + 3] = 255;
      } else {
        output.data[oi] = Math.round((output.data[oi] * oldWeight + tile.data[ti] * w) / nextWeight);
        output.data[oi + 1] = Math.round((output.data[oi + 1] * oldWeight + tile.data[ti + 1] * w) / nextWeight);
        output.data[oi + 2] = Math.round((output.data[oi + 2] * oldWeight + tile.data[ti + 2] * w) / nextWeight);
        output.data[oi + 3] = 255;
      }
      weights[outPixel] = nextWeight;
    }
  }
}
