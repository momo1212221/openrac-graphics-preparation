// SPDX-License-Identifier: GPL-3.0-or-later
export const PROFILE = {
  faithful: {residual: 0.28, sharpen: 0.04},
  balanced: {residual: 0.44, sharpen: 0.16},
  enhanced: {residual: 0.56, sharpen: 0.30},
};

const clamp8 = (value) => Math.max(0, Math.min(255, Math.round(value)));
const at = (width, x, y) => (y * width + x) * 4;
const lumaAt = (pixels, width, x, y) => {
  const i = at(width, x, y);
  return (54 * pixels[i] + 183 * pixels[i + 1] + 19 * pixels[i + 2]) >> 8;
};

function localMean(source, width, height, x, y) {
  const center = lumaAt(source, width, x, y);
  const rgb = [0, 0, 0];
  let count = 0;
  let closeBright = 0;
  for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
      if (xx === x && yy === y) continue;
      const i = at(width, xx, yy);
      if (source[i + 3] < 16) continue;
      rgb[0] += source[i];
      rgb[1] += source[i + 1];
      rgb[2] += source[i + 2];
      count++;
      if (lumaAt(source, width, xx, yy) >= center - 24) closeBright++;
    }
  }
  if (!count) return {rgb: [0, 0, 0], luma: 0, closeBright};
  rgb[0] = Math.trunc(rgb[0] / count);
  rgb[1] = Math.trunc(rgb[1] / count);
  rgb[2] = Math.trunc(rgb[2] / count);
  return {rgb, luma: (54 * rgb[0] + 183 * rgb[1] + 19 * rgb[2]) >> 8, closeBright};
}

function centerBlock(outWidth, outHeight, srcWidth, srcHeight, x, y) {
  const ox = Math.min(outWidth - 1, Math.trunc(((x * 2 + 1) * outWidth) / (srcWidth * 2)));
  const oy = Math.min(outHeight - 1, Math.trunc(((y * 2 + 1) * outHeight) / (srcHeight * 2)));
  const scale = Math.min(Math.trunc(outWidth / srcWidth), Math.trunc(outHeight / srcHeight));
  return scale >= 3
    ? [[ox, oy], [Math.min(ox + 1, outWidth - 1), oy], [ox, Math.min(oy + 1, outHeight - 1)]]
    : [[ox, oy]];
}

export function restoreSourceDetail(sourceData, outputData, mode, preserveMicrodetail, preserveStars) {
  const profile = PROFILE[mode];
  if (!profile) throw new Error(`unknown AI texture mode: ${mode}`);
  const {data: source, width: srcWidth, height: srcHeight} = sourceData;
  const {data: output, width: outWidth, height: outHeight} = outputData;
  let stars = 0;
  let microdetails = 0;

  if (preserveMicrodetail || preserveStars) {
    for (let y = 0; y < srcHeight; y++) {
      for (let x = 0; x < srcWidth; x++) {
        const si = at(srcWidth, x, y);
        if (source[si + 3] < 16) continue;
        const mean = localMean(source, srcWidth, srcHeight, x, y);
        const centerLuma = lumaAt(source, srcWidth, x, y);
        const contrast = centerLuma - mean.luma;
        const star = preserveStars && centerLuma >= 150 && mean.luma <= 112 && contrast >= 52 && mean.closeBright <= 2;
        const points = centerBlock(outWidth, outHeight, srcWidth, srcHeight, x, y);

        if (star) {
          for (const [ox, oy] of points) {
            const oi = at(outWidth, ox, oy);
            output[oi] = Math.max(output[oi], source[si]);
            output[oi + 1] = Math.max(output[oi + 1], source[si + 1]);
            output[oi + 2] = Math.max(output[oi + 2], source[si + 2]);
            output[oi + 3] = Math.max(output[oi + 3], source[si + 3]);
          }
          stars++;
          continue;
        }

        if (preserveMicrodetail && Math.abs(contrast) >= 24) {
          const residual = [
            source[si] - mean.rgb[0],
            source[si + 1] - mean.rgb[1],
            source[si + 2] - mean.rgb[2],
          ];
          for (const [ox, oy] of points) {
            const oi = at(outWidth, ox, oy);
            output[oi] = clamp8(output[oi] + residual[0] * profile.residual);
            output[oi + 1] = clamp8(output[oi + 1] + residual[1] * profile.residual);
            output[oi + 2] = clamp8(output[oi + 2] + residual[2] * profile.residual);
          }
          microdetails++;
        }
      }
    }
  }

  if (profile.sharpen > 0 && outWidth >= 3 && outHeight >= 3) {
    const original = new Uint8ClampedArray(output);
    for (let y = 1; y < outHeight - 1; y++) {
      for (let x = 1; x < outWidth - 1; x++) {
        const i = at(outWidth, x, y);
        if (original[i + 3] < 16) continue;
        for (let channel = 0; channel < 3; channel++) {
          const mean = (
            original[i - 4 + channel] +
            original[i + 4 + channel] +
            original[i - outWidth * 4 + channel] +
            original[i + outWidth * 4 + channel]
          ) * 0.25;
          const center = original[i + channel];
          output[i + channel] = clamp8(center + (center - mean) * profile.sharpen);
        }
      }
    }
  }
  return {stars, microdetails};
}
