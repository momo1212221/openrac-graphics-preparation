// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Detect only cases where bypassing a neural upscaler is lossless with respect to source content.
 * No variance threshold or heuristic similarity is used.
 */
export function trivialTexture(imageData) {
  const {data, width, height} = imageData;
  if (!width || !height || data.length < 4) return {trivial:false, reason:null};

  let allTransparent = true;
  const r0 = data[0], g0 = data[1], b0 = data[2], a0 = data[3];
  let uniform = true;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0) allTransparent = false;
    if (
      data[i] !== r0 ||
      data[i + 1] !== g0 ||
      data[i + 2] !== b0 ||
      data[i + 3] !== a0
    ) uniform = false;
    if (!allTransparent && !uniform) return {trivial:false, reason:null};
  }

  if (allTransparent) return {trivial:true, reason:"transparent"};
  if (uniform) return {trivial:true, reason:"uniform"};
  return {trivial:false, reason:null};
}
