// SPDX-License-Identifier: GPL-3.0-or-later
const lowerPaths = (paths) => (Array.isArray(paths) ? paths : [paths])
  .filter((value)=>typeof value === "string")
  .map((value)=>value.toLowerCase());

export function pathTextureScope(paths) {
  const rows = lowerPaths(paths);
  if (rows.some((p)=>p.startsWith("interface/"))) return "ui";
  if (rows.some((p)=>/(^|[/_.-])(normal|normals|nrm|normalmap)([/_.-]|$)/.test(p))) return "normal";
  if (rows.some((p)=>/(^|[/_.-])(mask|alpha|opacity|roughness|metallic|specular)([/_.-]|$)/.test(p))) return "mask";
  if (rows.some((p)=>/(^|[/_.-])(sky|skybox|background|cloud)([/_.-]|$)/.test(p))) return "sky";
  return "world";
}

function sampledStats(imageData) {
  const {data, width, height} = imageData;
  const pixels = width * height;
  const stride = Math.max(1, Math.floor(pixels / 4096));
  let visible = 0, blueNormal = 0, rSum = 0, gSum = 0, bSum = 0;
  let alphaMin = 255, alphaMax = 0;
  let rgbMin = 255, rgbMax = 0;
  let grayscale = 0;

  for (let pixel = 0; pixel < pixels; pixel += stride) {
    const i = pixel * 4;
    const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
    alphaMin=Math.min(alphaMin,a); alphaMax=Math.max(alphaMax,a);
    rgbMin=Math.min(rgbMin,r,g,b); rgbMax=Math.max(rgbMax,r,g,b);
    if (a < 16) continue;
    visible++;
    rSum+=r; gSum+=g; bSum+=b;
    if (b >= 165 && b >= r + 20 && b >= g + 20 && r >= 55 && r <= 205 && g >= 55 && g <= 205) blueNormal++;
    if (Math.abs(r-g) <= 2 && Math.abs(g-b) <= 2) grayscale++;
  }
  return {
    visible,
    blueNormalRatio:visible ? blueNormal/visible : 0,
    grayscaleRatio:visible ? grayscale/visible : 0,
    avgR:visible ? rSum/visible : 0,
    avgG:visible ? gSum/visible : 0,
    avgB:visible ? bSum/visible : 0,
    alphaRange:alphaMax-alphaMin,
    rgbRange:rgbMax-rgbMin,
  };
}

export function classifyTexture(paths, imageData) {
  const scope = pathTextureScope(paths);
  if (scope === "ui") return {kind:"ui", confidence:1, reason:"Interface path"};
  if (scope === "normal") return {kind:"normal", confidence:1, reason:"normal-map path hint"};
  if (scope === "mask") return {kind:"mask", confidence:1, reason:"technical-map path hint"};
  if (scope === "sky") return {kind:"sky", confidence:0.95, reason:"sky/background path hint"};

  const stats = sampledStats(imageData);
  if (
    stats.visible > 32 &&
    stats.blueNormalRatio >= 0.94 &&
    stats.avgB >= 180 &&
    stats.avgR >= 85 && stats.avgR <= 175 &&
    stats.avgG >= 85 && stats.avgG <= 175
  ) {
    return {kind:"normal", confidence:0.92, reason:"conservative tangent-normal signature"};
  }

  // Constant RGB with meaningful alpha variation is almost certainly an opacity/mask map.
  if (stats.visible > 16 && stats.rgbRange <= 3 && stats.alphaRange >= 24) {
    return {kind:"mask", confidence:0.94, reason:"constant colour with varying alpha"};
  }

  return {kind:"diffuse", confidence:0.7, reason:"default colour texture"};
}
