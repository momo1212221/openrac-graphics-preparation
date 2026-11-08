// SPDX-License-Identifier: GPL-3.0-or-later
const asBytes = (value) => value instanceof Uint8Array ? value : new Uint8Array(value);

const message = (error) => error instanceof Error ? error.message : String(error);

/**
 * A texture failure is isolated from the rest of the pack:
 * AI -> reset/retry AI -> deterministic 4x fallback -> original bytes.
 * Only caller-owned I/O (ZIP writes, disk full, cancelled save) is allowed to abort the whole run.
 */
export async function prepareTextureFailSafe(source, {
  ai,
  fallback,
  resetAi = async () => {},
  retries = 1,
} = {}) {
  const errors = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await ai();
      return {
        bytes: asBytes(result.bytes),
        strategy: "ai",
        attempts: attempt + 1,
        stars: result.stars ?? 0,
        microdetails: result.microdetails ?? 0,
        backend: result.backend ?? null,
        skipped: result.skipped === true,
        skipReason: result.skipReason ?? null,
        elapsedMs: Number(result.elapsedMs) || 0,
        tiles: Number(result.tiles) || 0,
        textureClass: result.textureClass ?? null,
        detailQuality: result.detailQuality ?? null,
        material: result.material ?? null,
        detailCnnUsed: result.detailCnnUsed === true,
        detailPixels: Number(result.detailPixels) || 0,
        metrics: result.metrics ?? null,
        errors,
      };
    } catch (error) {
      errors.push(`AI attempt ${attempt + 1}: ${message(error)}`);
      if (attempt < retries) {
        try {
          await resetAi();
        } catch (resetError) {
          errors.push(`AI reset: ${message(resetError)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  try {
    return {
      bytes: asBytes(await fallback()),
      strategy: "fallback",
      attempts: retries + 1,
      stars: 0,
      microdetails: 0,
      errors,
    };
  } catch (error) {
    errors.push(`4x fallback: ${message(error)}`);
  }

  return {
    bytes: asBytes(source),
    strategy: "original",
    attempts: retries + 1,
    stars: 0,
    microdetails: 0,
    errors,
  };
}

export async function readFailSafe(read, attempts = 2) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return {bytes: asBytes(await read()), attempts: attempt};
    } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw last;
}
