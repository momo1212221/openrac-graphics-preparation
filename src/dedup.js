// SPDX-License-Identifier: GPL-3.0-or-later
const asBytes = (value) => value instanceof Uint8Array ? value : new Uint8Array(value);

export function bytesEqual(a, b) {
  const left = asBytes(a), right = asBytes(b);
  if (left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i++) if (left[i] !== right[i]) return false;
  return true;
}

/**
 * Fast non-cryptographic bucket key. It is never trusted on its own: every candidate match is
 * confirmed byte-for-byte, so a fingerprint collision cannot merge different textures.
 */
export function byteFingerprint(value) {
  const bytes = asBytes(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul((h1 ^ bytes[i]) >>> 0, 0x01000193) >>> 0;
    h2 = Math.imul((h2 ^ ((bytes[i] + i) & 255)) >>> 0, 0x85ebca6b) >>> 0;
  }
  return `${bytes.byteLength}:${h1.toString(16)}:${h2.toString(16)}`;
}

const knownSize = (texture) =>
  Number.isFinite(texture?.size) && texture.size >= 0 ? Number(texture.size) : null;

/**
 * Build an exact-content duplicate plan without retaining all source images.
 *
 * 1. Different file sizes can never be byte-identical, so single-size entries need no read here.
 * 2. Only same-size candidates are read.
 * 3. A quick fingerprint narrows comparisons.
 * 4. A byte-for-byte comparison is the authority.
 *
 * If a candidate cannot be read during the duplicate scan it remains its own group. The real
 * processing pass can retry it later; duplicate detection never makes a texture unusable.
 */
export async function buildDuplicatePlan(textures, read, onProgress = () => {}) {
  const rows = Array.isArray(textures) ? textures : [];
  const bySize = new Map();
  for (const texture of rows) {
    const size = knownSize(texture);
    const key = size === null ? "unknown" : `size:${size}`;
    const bucket = bySize.get(key) || [];
    bucket.push(texture);
    bySize.set(key, bucket);
  }

  const groups = [];
  let done = 0;
  let compared = 0;
  let unverified = 0;

  for (const [sizeKey, bucket] of bySize) {
    if (bucket.length === 1 && sizeKey !== "unknown") {
      groups.push({members:[bucket[0]], verified:true});
      done++;
      onProgress(done, rows.length, {duplicates:0, groups:groups.length});
      continue;
    }

    const byFingerprint = new Map();
    for (const texture of bucket) {
      let bytes;
      try {
        bytes = asBytes(await read(texture));
      } catch (error) {
        groups.push({
          members:[texture],
          verified:false,
          scanError:error instanceof Error ? error.message : String(error),
        });
        unverified++;
        done++;
        onProgress(done, rows.length, {duplicates:done - groups.length, groups:groups.length});
        continue;
      }

      compared++;
      const fingerprint = byteFingerprint(bytes);
      const candidates = byFingerprint.get(fingerprint) || [];
      let match = null;
      for (const candidate of candidates) {
        if (bytesEqual(bytes, candidate.representative)) {
          match = candidate;
          break;
        }
      }

      if (match) {
        match.members.push(texture);
      } else {
        const group = {members:[texture], representative:bytes, verified:true};
        candidates.push(group);
        byFingerprint.set(fingerprint, candidates);
      }
      done++;
      const localGroups = [...byFingerprint.values()].reduce((n, list) => n + list.length, 0);
      const previousGroups = groups.length;
      onProgress(done, rows.length, {
        duplicates:done - (previousGroups + localGroups),
        groups:previousGroups + localGroups,
      });
    }

    for (const candidates of byFingerprint.values()) {
      for (const group of candidates) {
        groups.push({members:group.members, verified:true});
      }
    }
  }

  const duplicates = groups.reduce((sum, group) => sum + Math.max(0, group.members.length - 1), 0);
  return {
    groups,
    duplicates,
    uniqueSources:groups.length,
    compared,
    unverified,
  };
}
