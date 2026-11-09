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

export function texturePackManifest(info, count, options = {}) {
  if (!info || typeof info.packId !== "string" || !info.packId) throw new TypeError("missing OpenRAC pack id");
  const ai = options.ai === true;
  return {
    format: 1,
    game: info.packId,
    name: ai ? "Graphics preparation AI 4x" : `Graphics preparation ${options.scale ?? 4}x`,
    textures: count,
    madeWith: ai
      ? `Graphics preparation ${info.mod?.version ?? "0.21.2"} (dual-CNN ${options.mode ?? "balanced"} · ${options.detailQuality ?? "high"} detail)`
      : `Graphics preparation ${info.mod?.version ?? "0.21.2"} (${options.edgePreserving ? "edge-preserving" : "smooth"})`,
  };
}

export function outputName(info, suffix) {
  const id = String(info?.packId || "openrac").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  return `${id}-graphics-preparation-${suffix}`;
}

export function packPath(texture) {
  return `Upscaled/${texture.hash}.png`;
}


export function mipmapPath(texture,level){
  const n=Math.max(1,Math.floor(Number(level)||1));
  return `Mipmaps/${texture.hash}/mip${n}.png`;
}
