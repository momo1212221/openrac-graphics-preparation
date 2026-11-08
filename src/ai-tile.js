// SPDX-License-Identifier: GPL-3.0-or-later
export const MODEL_INPUT = 128;
export const SCALE = 4;
export const PAD = 8;
export const CORE = MODEL_INPUT - PAD * 2;

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

/**
 * Fill a reusable fixed-size RGB tensor input for the pinned Real-ESRGAN x4plus ONNX model.
 * Pixels outside the source texture are edge-clamped instead of shrinking the model input.
 */
export function fillFixedRgbTile(sourceData, sourceX, sourceY, values) {
  const {width, height, data} = sourceData;
  if (!width || !height) throw new Error("empty source texture");
  const plane = MODEL_INPUT * MODEL_INPUT;
  if (!(values instanceof Float32Array) || values.length !== plane * 3) {
    throw new TypeError(`tile buffer must be Float32Array(${plane * 3})`);
  }

  for (let ty = 0; ty < MODEL_INPUT; ty++) {
    const sy = clamp(sourceY - PAD + ty, 0, height - 1);
    for (let tx = 0; tx < MODEL_INPUT; tx++) {
      const sx = clamp(sourceX - PAD + tx, 0, width - 1);
      const sourceAt = (sy * width + sx) * 4;
      const tileAt = ty * MODEL_INPUT + tx;
      values[tileAt] = data[sourceAt] / 255;
      values[plane + tileAt] = data[sourceAt + 1] / 255;
      values[plane * 2 + tileAt] = data[sourceAt + 2] / 255;
    }
  }
  return values;
}

/**
 * Compatibility helper for tests and callers that do not keep a reusable tensor buffer.
 */
export function fixedRgbTile(sourceData, sourceX, sourceY) {
  return fillFixedRgbTile(
    sourceData,
    sourceX,
    sourceY,
    new Float32Array(3 * MODEL_INPUT * MODEL_INPUT),
  );
}
