// SPDX-License-Identifier: GPL-3.0-or-later
const HASH_PNG = /^([0-9a-f]{16})\.png$/i;

export function textureFiles(files, {includeInterface = true} = {}) {
  const byHash = new Map();
  for (const file of files ?? []) {
    if (!file || typeof file.path !== "string") continue;
    if (!includeInterface && file.path.toLowerCase().startsWith("interface/")) continue;
    const name = file.path.split("/").pop() ?? "";
    const match = HASH_PNG.exec(name);
    if (!match) continue;
    const hash = match[1].toLowerCase();
    if (!byHash.has(hash)) byHash.set(hash, {...file, hash});
  }
  return [...byHash.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function texturePackManifest(info, count, scale, edgePreserving) {
  if (!info || typeof info.packId !== "string" || !info.packId) throw new TypeError("missing OpenRAC pack id");
  return {
    format: 1,
    game: info.packId,
    name: `Graphics preparation ${scale}x`,
    textures: count,
    madeWith: `Graphics preparation 0.3.0 (${edgePreserving ? "edge-preserving" : "smooth"})`,
  };
}

export function outputName(info, scale) {
  const id = String(info?.packId || "openrac").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  return `${id}-graphics-preparation-${scale}x`;
}

export function packPath(texture) {
  return `Upscaled/${texture.hash}.png`;
}
