// SPDX-License-Identifier: GPL-3.0-or-later
const DB_NAME = "openrac-graphics-preparation-ai-cache";
const DB_VERSION = 1;
const STORE = "textures";
const PIPELINE = "realesrgan-x4plus-725b1db7|adaptive-context-v4|dual-cnn-v1|quality-guard-v3|tier-90-94-97-v2|seam-wrap-v1|auto-quality-v2|frequency-v2|master8x-v1|failure-v1|specialized-refine-v2";
let dbPromise;
let sessionDisabled = false;
let writesSinceTrim = 0;

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
});

function available() {
  return !sessionDisabled &&
    typeof indexedDB !== "undefined" &&
    typeof crypto !== "undefined" &&
    !!crypto.subtle;
}

async function db() {
  if (!available()) throw new Error("persistent AI cache is unavailable");
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const database = open.result;
        const store = database.objectStoreNames.contains(STORE)
          ? open.transaction.objectStore(STORE)
          : database.createObjectStore(STORE, {keyPath:"key"});
        if (!store.indexNames.contains("lastUsed")) store.createIndex("lastUsed", "lastUsed");
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error || new Error("could not open persistent AI cache"));
      open.onblocked = () => reject(new Error("persistent AI cache is blocked by another view"));
    }).catch((error) => {
      sessionDisabled = true;
      dbPromise = undefined;
      throw error;
    });
  }
  return dbPromise;
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((b)=>b.toString(16).padStart(2,"0")).join("");

export async function sourceDigest(bytes) {
  if (!available()) return null;
  try {
    return hex(await crypto.subtle.digest("SHA-256", bytes));
  } catch {
    sessionDisabled = true;
    return null;
  }
}

export function cacheKey(digest, options = {}) {
  if (!digest) return null;
  const mode = ["faithful","balanced","enhanced"].includes(options.mode) ? options.mode : "balanced";
  return [
    PIPELINE,
    digest,
    mode,
    options.preserveMicrodetail !== false ? "micro1" : "micro0",
    options.preserveStars !== false ? "stars1" : "stars0",
    ["standard","high","max"].includes(options.detailQuality) ? options.detailQuality : "high",
    options.textureScope || "world",
    options.detailCnn !== false ? "detailcnn1" : "detailcnn0",
    options.sourceColorLock !== false ? "colorlock1" : "colorlock0",
    options.qualityGuard !== false ? "qguard1" : "qguard0",
    "policy-"+(options.qualityPolicyVersion||"legacy"),
    options.master8x !== false ? "master8x1" : "master8x0",
    "specialized-"+(options.specializedFingerprint||"none"),
    options.textureClassOverride || "class-auto",
    options.materialOverride || "material-auto",
  ].join("|");
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
  });
}

export async function cacheGet(key) {
  if (!key || !available()) return null;
  try {
    const database = await db();
    const tx = database.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const row = await request(store.get(key));
    if (!row || !(row.bytes instanceof Uint8Array || row.bytes instanceof ArrayBuffer)) {
      await txDone(tx);
      return null;
    }
    row.lastUsed = Date.now();
    store.put(row);
    await txDone(tx);
    return {
      bytes: row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes),
      stars: Number(row.stars) || 0,
      microdetails: Number(row.microdetails) || 0,
      size: Number(row.size) || row.bytes.byteLength || 0,
      textureClass: row.textureClass || null,
      detailQuality: row.detailQuality || null,
      material: row.material || null,
      metrics: row.metrics || null,
      classification: row.classification || null,
      materialInfo: row.materialInfo || null,
      wrap: row.wrap || null,
      failures: row.failures || null,
      masterScale:Number(row.masterScale)||4,
      internalMaster:row.internalMaster===true,
      specializedCnnUsed:row.specializedCnnUsed===true,
      specializedRejected:row.specializedRejected===true,
      specializedModelSha:row.specializedModelSha||null,
      textureComplexity:Number(row.textureComplexity)||0,
      tileGeometry:row.tileGeometry||null,
    };
  } catch {
    sessionDisabled = true;
    return null;
  }
}

async function rowsByAge(database) {
  const tx = database.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const rows = await request(store.getAll());
  await txDone(tx);
  return rows
    .map((row)=>({key:row.key,lastUsed:Number(row.lastUsed)||0,size:Number(row.size)||row.bytes?.byteLength||0}))
    .sort((a,b)=>a.lastUsed-b.lastUsed);
}

export async function trimCache(maxBytes) {
  if (!available()) return {available:false,total:0,removed:0};
  try {
    const database = await db();
    const rows = await rowsByAge(database);
    let total = rows.reduce((sum,row)=>sum+row.size,0);
    if (!(maxBytes > 0) || total <= maxBytes) return {available:true,total,removed:0};

    const tx = database.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let removed = 0;
    const target = Math.max(0, maxBytes * 0.90);
    for (const row of rows) {
      if (total <= target) break;
      store.delete(row.key);
      total -= row.size;
      removed++;
    }
    await txDone(tx);
    return {available:true,total,removed};
  } catch {
    sessionDisabled = true;
    return {available:false,total:0,removed:0};
  }
}

export async function cachePut(key, result, maxBytes) {
  if (!key || !available() || !result?.bytes) return false;
  const bytes = result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes);
  const row = {
    key,
    bytes,
    size:bytes.byteLength,
    stars:Number(result.stars)||0,
    microdetails:Number(result.microdetails)||0,
    textureClass:result.textureClass||null,
    detailQuality:result.detailQuality||null,
    material:result.material||null,
    metrics:result.metrics||null,
    classification:result.classification||null,
    materialInfo:result.materialInfo||null,
    wrap:result.wrap||null,
    failures:result.failures||null,
    masterScale:Number(result.masterScale)||4,
    internalMaster:result.internalMaster===true,
    specializedCnnUsed:result.specializedCnnUsed===true,
    specializedRejected:result.specializedRejected===true,
    specializedModelSha:result.specializedModelSha||null,
    textureComplexity:Number(result.textureComplexity)||0,
    tileGeometry:result.tileGeometry||null,
    lastUsed:Date.now(),
    created:Date.now(),
  };

  const put = async () => {
    const database = await db();
    const tx = database.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row);
    await txDone(tx);
  };

  try {
    await put();
    writesSinceTrim++;
    if (writesSinceTrim >= 32) {
      writesSinceTrim = 0;
      await trimCache(maxBytes);
    }
    return true;
  } catch (error) {
    // Quota errors are recoverable: evict old entries aggressively and retry once.
    try {
      await trimCache(Math.max(64 * 1024 * 1024, maxBytes * 0.65));
      await put();
      return true;
    } catch {
      sessionDisabled = true;
      return false;
    }
  }
}

export async function clearAiCache() {
  if (typeof indexedDB === "undefined") return false;
  try {
    if (dbPromise) {
      try { (await dbPromise).close(); } catch {}
      dbPromise = undefined;
    }
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("could not clear AI cache"));
      req.onblocked = () => reject(new Error("AI cache is still open"));
    });
    sessionDisabled = false;
    return true;
  } catch {
    return false;
  }
}

export async function cacheInfo() {
  if (!available()) return {available:false,total:0,entries:0};
  try {
    const database = await db();
    const rows = await rowsByAge(database);
    return {
      available:true,
      entries:rows.length,
      total:rows.reduce((sum,row)=>sum+row.size,0),
    };
  } catch {
    return {available:false,total:0,entries:0};
  }
}
