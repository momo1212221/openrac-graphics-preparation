// SPDX-License-Identifier: GPL-3.0-or-later
import {request} from "./bridge.js";
import {ModController} from "../src/controller.js";
import {resetAiSession, warmAi, upscaleAiMasterPng} from "../src/ai-runtime.js";
import {prepareTextureFailSafe, readFailSafe} from "../src/resilience.js";
import {textureFiles, texturePackManifest, outputName, packPath} from "../src/texture-pack.js";
import {upscalePng} from "../src/upscale.js";
import {ZipStream} from "../src/zip.js";
import {EffectsEditor} from "./effects.js";
import {buildDuplicatePlan} from "../src/dedup.js";
import {cacheGet, cacheInfo, cacheKey, cachePut, clearAiCache, sourceDigest, trimCache} from "../src/ai-cache.js";
import {pathTextureScope} from "../src/texture-classify.js";
import {prioritizeGroups} from "../src/priority.js";
import {QualityLab} from "./quality-lab.js";
import {generateMaterialMapPngs,shouldGenerateMaterialMaps} from "../src/material-maps.js";
import {chooseBetterQuality,evaluateQuality} from "../src/quality-policy.js";
import {automaticDetailQuality,refinedDetailQuality} from "../src/quality-planner.js";
import {specializedRegistryIdentity} from "../src/specialized-models.js";
import {buildQualityReport} from "../src/quality-report.js";

const controller = new ModController(request);
const content = document.querySelector("#content");
const message = document.querySelector("#message");
const subtitle = document.querySelector("#subtitle");
const encoder = new TextEncoder();

let info;
let allDumpFiles = [];
let textures = [];
let busy = false;
let aiReady = null;
let effectsEditor = null;
let cacheState = {available:false,total:0,entries:0};
let qualityLab = null;
let state = {
  scale: 4,
  edgePreserving: true,
  includeInterface: true,
  aiMode: "balanced",
  preserveMicrodetail: true,
  preserveStars: true,
  aiBackend: "auto",
  persistentCache: true,
  cacheBudgetMb: 2048,
  detailQuality: "auto",
  detailCnn: true,
  sourceColorLock: true,
  qualityGuard: true,
  master8x: true,
  materialMaps: "off",
};

const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll("button,input,select").forEach((node) => { node.disabled = value; });
}

async function savePrefs() { await controller.storeSet("texture-preparation", state); }

function settingRow(title, description) {
  const row = el("div", undefined, "setting-row");
  const words = el("div", undefined, "setting-text");
  words.append(el("strong", title), el("p", description, "muted"));
  const control = el("div", undefined, "setting-control");
  row.append(words, control);
  return {row, control};
}

function segmented(values, selected, onchange) {
  const group = el("div", undefined, "segmented");
  for (const [value, label] of values) {
    const button = el("button", label);
    button.classList.toggle("selected", value === selected);
    button.type = "button";
    button.onclick = () => onchange(value);
    group.append(button);
  }
  return group;
}

function select(values, selected, onchange) {
  const input = document.createElement("select");
  input.className = "select";
  for (const [value, label] of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    input.append(option);
  }
  input.value = selected;
  input.onchange = () => onchange(input.value);
  return input;
}

function toggle(checked, label, onchange) {
  const wrap = el("label", undefined, "toggle");
  wrap.append(el("span", checked ? "On" : "Off"));
  const input = document.createElement("input");
  input.type = "checkbox";
  input.role = "switch";
  input.className = "switch";
  input.checked = checked;
  input.setAttribute("aria-label", label);
  input.onchange = () => onchange(input.checked);
  wrap.append(input);
  return wrap;
}

function updateTextures() {
  textures = textureFiles(allDumpFiles, {includeInterface: state.includeInterface});
  qualityLab?.setTextures(textures);
}
async function scan() { allDumpFiles = await controller.list("dump"); updateTextures(); render(); }

function progress(done, total, label) {
  const text = document.querySelector("#progress-text");
  const bar = document.querySelector("#progress-bar");
  if (text) text.textContent = label;
  if (bar) bar.style.width = total ? `${Math.round(done / total * 100)}%` : "0%";
}

async function createPack({ai}) {
  if (busy) return;
  if (!textures.length) {
    setMessage("No saved OpenRAC textures found. Enable texture dumping in Models and textures, play the game, then return here.", true);
    return;
  }

  setBusy(true);
  let zip = null;
  const stats = {
    ai: 0,
    retried: 0,
    fallback: 0,
    original: 0,
    unreadable: 0,
    stars: 0,
    microdetails: 0,
    warnings: [],
    duplicateTextures: 0,
    uniqueSources: textures.length,
    duplicateScanUnverified: 0,
    aiRuns: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheWrites: 0,
    smartSkipped: 0,
    aiElapsedMs: 0,
    aiTiles: 0,
    classes: {diffuse:0,ui:0,sky:0,normal:0,mask:0},
    materials: {},
    detailCnnRuns:0,
    detailPixels:0,
    qualityScoreSum:0,
    qualityScoreCount:0,
    materialMapSets:0,
    master8xRuns:0,
    failureRejected:0,
    specializedCnnRuns:0,
    specializedCnnRejected:0,
    qualityRows:[],
  };

  try {
    let specializedFingerprint="none";
    if (ai) {
      progress(0, 1, "AI preflight · model + 128×128 inference check…");
      [aiReady,specializedFingerprint]=await Promise.all([
        warmAi(state.aiBackend),
        specializedRegistryIdentity(),
      ]);
    }

    let workGroups = textures.map((texture) => ({members:[texture], verified:true}));
    if (ai) {
      progress(0, 1, "Duplicate scan · grouping identical PNG contents…");
      const plan = await buildDuplicatePlan(
        textures,
        async (texture) => {
          const read = await readFailSafe(() => controller.read("dump", texture.path), 2);
          if (read.attempts > 1) stats.retried++;
          return read.bytes;
        },
        (done, total, snapshot) => {
          progress(done, total, `Duplicate scan · ${done}/${total} · ${snapshot.duplicates} duplicates found`);
        },
      );
      workGroups = prioritizeGroups(plan.groups);
      stats.duplicateTextures = plan.duplicates;
      stats.uniqueSources = plan.uniqueSources;
      stats.duplicateScanUnverified = plan.unverified;
      setMessage(
        plan.duplicates
          ? `Duplicate scan: ${plan.duplicates} exact duplicate textures found. Only ${plan.uniqueSources} unique sources need processing.`
          : `Duplicate scan: no exact content duplicates found across ${textures.length} textures.`,
      );
    }

    const suffix = ai ? `ai-${state.aiMode}-4x` : `${state.scale}x`;
    const token = await controller.saveStart(outputName(info, suffix), "zip");
    if (!token) { setMessage("Save cancelled."); return; }
    zip = new ZipStream(controller, token);

    let included = 0;
    for (let groupIndex = 0; groupIndex < workGroups.length; groupIndex++) {
      const group = workGroups[groupIndex];
      const primary = group.members[0];
      const baseLabel = ai
        ? `unique ${groupIndex + 1}/${workGroups.length} · ${group.members.length} output${group.members.length === 1 ? "" : "s"} · ${primary.hash}`
        : `${groupIndex + 1}/${workGroups.length} · ${primary.hash}`;
      let source = null;
      let readError = null;

      for (const member of group.members) {
        try {
          const read = await readFailSafe(() => controller.read("dump", member.path), 2);
          source = read.bytes;
          if (read.attempts > 1) stats.retried++;
          break;
        } catch (error) {
          readError = error;
        }
      }

      if (!source) {
        stats.unreadable += group.members.length;
        stats.warnings.push({
          hashes:group.members.map((member)=>member.hash),
          strategy:"skipped",
          error:readError instanceof Error ? readError.message : String(readError),
        });
        progress(groupIndex + 1, workGroups.length, `Skipped unreadable source group · ${baseLabel}`);
        continue;
      }

      if (ai) {
        const texturePaths = group.members.map((member)=>member.path);
        const override = qualityLab?.getOverride(primary.hash) || {};
        const effectiveDetailQuality = ["standard","high","max"].includes(override.quality)
          ? override.quality : automaticDetailQuality(primary, state.detailQuality);
        const cacheOptions = {
          mode: state.aiMode,
          detailQuality: effectiveDetailQuality,
          preserveMicrodetail: state.preserveMicrodetail,
          preserveStars: state.preserveStars,
          textureScope: pathTextureScope(texturePaths),
          detailCnn: state.detailCnn,
          sourceColorLock: state.sourceColorLock,
          qualityGuard: state.qualityGuard,
          master8x: state.master8x,
          specializedFingerprint,
          textureClassOverride: override.textureClass || null,
          materialOverride: override.material || null,
        };
        let key = null;
        let digest = null;
        let prepared = null;

        if (state.persistentCache) {
          digest = await sourceDigest(source);
          key = cacheKey(digest, cacheOptions);
          const hit = await cacheGet(key);
          if (hit) {
            stats.cacheHits++;
            prepared = {
              bytes: hit.bytes,
              strategy: "ai",
              attempts: 0,
              stars: hit.stars,
              microdetails: hit.microdetails,
              textureClass: hit.textureClass,
              material: hit.material,
              detailQuality: hit.detailQuality,
              metrics: hit.metrics,
              classification: hit.classification,
              materialInfo: hit.materialInfo,
              failures: hit.failures,
              masterScale: hit.masterScale,
              internalMaster: hit.internalMaster,
              specializedCnnUsed:hit.specializedCnnUsed,
              specializedRejected:hit.specializedRejected,
              specializedModelSha:hit.specializedModelSha,
              errors: [],
              cached: true,
            };
            progress(groupIndex + 1, workGroups.length, `Cache hit · ${baseLabel}`);
          } else {
            stats.cacheMisses++;
          }
        }

        if (!prepared && override.quality === "no-ai") {
          prepared = {
            bytes: await upscalePng(source, 4, true),
            strategy: "fallback",
            attempts: 0,
            stars: 0,
            microdetails: 0,
            backend: "manual-no-ai",
            skipped: true,
            skipReason: "manual-no-ai",
            errors: [],
          };
        }

        if (!prepared) prepared = await prepareTextureFailSafe(source, {
          ai: () => upscaleAiMasterPng(source, {
            mode: state.aiMode,
            preserveMicrodetail: state.preserveMicrodetail,
            preserveStars: state.preserveStars,
            backend: state.aiBackend,
            detailQuality: effectiveDetailQuality,
            detailCnn: state.detailCnn,
            sourceColorLock: state.sourceColorLock,
            master8x: state.master8x,
            texturePaths,
            textureClassOverride: cacheOptions.textureClassOverride,
            materialOverride: cacheOptions.materialOverride,
          }, (tile, totalTiles) => {
            const fraction = (groupIndex + tile / totalTiles) / workGroups.length;
            progress(fraction, 1, `AI · ${baseLabel} · tile ${tile}/${totalTiles}`);
          }),
          resetAi: resetAiSession,
          fallback: () => upscalePng(source, 4, true),
          retries: 1,
        });

        if (
          state.detailQuality === "auto" && !override.quality &&
          prepared.strategy === "ai" && !prepared.skipped
        ) {
          const refinedQuality = refinedDetailQuality(prepared, effectiveDetailQuality);
          if (refinedQuality !== effectiveDetailQuality) {
            try {
              const refined = await upscaleAiMasterPng(source, {
                mode: state.aiMode,
                detailQuality: refinedQuality,
                detailCnn: state.detailCnn,
                sourceColorLock: state.sourceColorLock,
                master8x: state.master8x,
                preserveMicrodetail: state.preserveMicrodetail,
                preserveStars: state.preserveStars,
                backend: state.aiBackend,
                texturePaths,
                textureClassOverride: cacheOptions.textureClassOverride,
                materialOverride: cacheOptions.materialOverride,
              });
              const promoted = refinedQuality === "max" &&
                (refined.metrics?.score ?? 0) >= (prepared.metrics?.score ?? 0) - 2;
              const selected = promoted ? refined : chooseBetterQuality(prepared, refined);
              if (selected === refined) {
                prepared = {...prepared,...refined,strategy:"ai",attempts:prepared.attempts,errors:prepared.errors,cached:false};
                stats.warnings.push({
                  hashes:group.members.map((member)=>member.hash),
                  strategy:refinedQuality === "max" ? "quality-promoted" : "quality-refined",
                  from:effectiveDetailQuality,to:refinedQuality,metrics:refined.metrics,
                });
              }
            } catch {}
          }
        }

        if (
          state.qualityGuard && prepared.strategy === "ai" && !prepared.cached && !prepared.skipped &&
          prepared.metrics?.score !== undefined && evaluateQuality(prepared.metrics, prepared).retry
        ) {
          try {
            const conservative = await upscaleAiMasterPng(source, {
              mode: state.aiMode,
              detailQuality: prepared.detailQuality === "max" ? "high" : "standard",
              detailCnn: false,
              sourceColorLock: true,
              master8x: false,
              preserveMicrodetail: state.preserveMicrodetail,
              preserveStars: state.preserveStars,
              backend: state.aiBackend,
              texturePaths,
              textureClassOverride: cacheOptions.textureClassOverride,
              materialOverride: cacheOptions.materialOverride,
            });
            if (chooseBetterQuality(prepared, conservative) === conservative) {
              prepared.bytes = conservative.bytes;
              prepared.stars = conservative.stars;
              prepared.microdetails = conservative.microdetails;
              prepared.backend = conservative.backend;
              prepared.textureClass = conservative.textureClass;
              prepared.material = conservative.material;
              prepared.detailQuality = conservative.detailQuality;
              prepared.detailCnnUsed = false;
              prepared.detailPixels = 0;
              prepared.metrics = conservative.metrics;
              prepared.classification = conservative.classification;
              prepared.materialInfo = conservative.materialInfo;
              prepared.failures = conservative.failures;
              prepared.internalMaster = conservative.internalMaster;
              prepared.masterScale = conservative.masterScale;
              stats.warnings.push({hashes:group.members.map(m=>m.hash),strategy:"quality-recovered",metrics:conservative.metrics});
            }
          } catch {}
        }

        if (state.qualityGuard && prepared.metrics?.score!==undefined) {
          const policy=evaluateQuality(prepared.metrics,prepared);
          if((policy.fallback || prepared.failures?.ok===false) && prepared.strategy==="ai" && !prepared.cached && !prepared.skipped){
            prepared.bytes=await upscalePng(source,4,true);
            prepared.strategy="fallback";
            prepared.backend="quality-guard-fallback";
            prepared.skipped=true;
            prepared.skipReason="quality-reject";
            prepared.detailCnnUsed=false;
            prepared.detailPixels=0;
            stats.failureRejected++;
            stats.warnings.push({hashes:group.members.map((member)=>member.hash),strategy:"quality-rejected",metrics:prepared.metrics,policy,failures:prepared.failures});
          }else if(policy.verdict!=="pass"){
            stats.warnings.push({hashes:group.members.map((member)=>member.hash),strategy:"quality-warning",metrics:prepared.metrics,policy});
          }
        }

        if (prepared.strategy === "ai" && !prepared.cached && !prepared.skipped && digest && state.persistentCache) {
          key = cacheKey(digest, {...cacheOptions, detailQuality:prepared.detailQuality || effectiveDetailQuality});
          const cached = await cachePut(
            key,
            prepared,
            Math.max(256, state.cacheBudgetMb) * 1024 * 1024,
          );
          if (cached) stats.cacheWrites++;
        }

        if (prepared.attempts > 1) stats.retried++;
        const copies = group.members.length;
        stats[prepared.strategy] += copies;
        if (prepared.strategy === "ai" && prepared.skipped) stats.smartSkipped += copies;
        if (prepared.textureClass && prepared.textureClass in stats.classes) stats.classes[prepared.textureClass] += copies;
        if(prepared.material)stats.materials[prepared.material]=(stats.materials[prepared.material]||0)+copies;
        if(prepared.detailCnnUsed)stats.detailCnnRuns++;
        if(prepared.internalMaster)stats.master8xRuns++;
        if(prepared.specializedCnnUsed)stats.specializedCnnRuns++;
        if(prepared.specializedRejected)stats.specializedCnnRejected++;
        stats.detailPixels+=prepared.detailPixels||0;
        if(prepared.metrics?.score!==undefined){
          stats.qualityScoreSum+=prepared.metrics.score;stats.qualityScoreCount++;

        }
        for (const member of group.members) {
          stats.qualityRows.push({
            hash:member.hash,
            path:member.path,
            strategy:prepared.strategy,
            textureClass:prepared.textureClass,
            material:prepared.material,
            detailQuality:prepared.detailQuality,
            backend:prepared.backend,
            masterScale:prepared.masterScale,
            cached:prepared.cached,
            specializedCnnUsed:prepared.specializedCnnUsed,
            specializedRejected:prepared.specializedRejected,
            specializedModelSha:prepared.specializedModelSha,
            metrics:prepared.metrics,
            failures:prepared.failures,
          });
        }
        if (prepared.strategy === "ai" && !prepared.cached && !prepared.skipped) stats.aiRuns++;
        stats.stars += prepared.stars;
        stats.microdetails += prepared.microdetails;
        if (!prepared.cached) {
          stats.aiElapsedMs += prepared.elapsedMs || 0;
          stats.aiTiles += prepared.tiles || 0;
        }
        if (prepared.strategy !== "ai") {
          stats.warnings.push({
            hashes:group.members.map((member)=>member.hash),
            strategy:prepared.strategy,
            errors:prepared.errors.slice(-3),
          });
        }
        let generatedMaps = null;
        if (
          state.materialMaps !== "off" &&
          shouldGenerateMaterialMaps(prepared.textureClass, prepared.material, state.materialMaps)
        ) {
          try {
            generatedMaps = await generateMaterialMapPngs(prepared.bytes, prepared.material || "generic");
            stats.materialMapSets += group.members.length;
          } catch (error) {
            stats.warnings.push({
              hashes:group.members.map((member)=>member.hash),
              strategy:"material-map-failed",
              error:error instanceof Error?error.message:String(error),
            });
          }
        }
        for (const member of group.members) {
          await zip.add(packPath(member), prepared.bytes);
          if (generatedMaps) {
            const root = `Materials/${member.hash}/`;
            await zip.add(root+"normal.png", generatedMaps.normal);
            await zip.add(root+"roughness.png", generatedMaps.roughness);
            await zip.add(root+"height.png", generatedMaps.height);
            await zip.add(root+"ao.png", generatedMaps.ao);
            await zip.add(root+"emissive.png", generatedMaps.emissive);
            await zip.add(root+"specular.png", generatedMaps.specular);
            await zip.add(root+"metallic.png", generatedMaps.metallic);
            await zip.add(root+"cavity.png", generatedMaps.cavity);
            await zip.add(root+"curvature.png", generatedMaps.curvature);
            await zip.add(root+"edgewear.png", generatedMaps.edgewear);
            const meta = {
              format:1,
              generator:"Graphics preparation 0.12.0",
              material:prepared.material || "generic",
              textureClass:prepared.textureClass || "diffuse",
              emissivePixels:generatedMaps.emissivePixels,
              sourceHash:member.hash,
            };
            await zip.add(root+"material.json", encoder.encode(JSON.stringify(meta,null,2)+"\n"));
          }
          included++;
        }
      } else {
        let prepared;
        try {
          prepared = await upscalePng(source, state.scale, state.edgePreserving);
        } catch (error) {
          prepared = source;
          stats.original += group.members.length;
          stats.warnings.push({
            hashes:group.members.map((member)=>member.hash),
            strategy:"original",
            error:error instanceof Error ? error.message : String(error),
          });
        }
        progress(groupIndex + 1, workGroups.length, `Local fallback · ${baseLabel}`);
        for (const member of group.members) {
          await zip.add(packPath(member), prepared);
          included++;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const manifest = texturePackManifest(info, included, ai
      ? {ai: true, mode: state.aiMode, detailQuality: state.detailQuality}
      : {scale: state.scale, edgePreserving: state.edgePreserving});
    manifest.resilience = {
      version: 1,
      requested: textures.length,
      included,
      ai: stats.ai,
      retried: stats.retried,
      fallback: stats.fallback,
      original: stats.original,
      unreadable: stats.unreadable,
      unique_sources: stats.uniqueSources,
      exact_duplicates: stats.duplicateTextures,
      duplicate_scan_unverified: stats.duplicateScanUnverified,
      ai_runs: stats.aiRuns,
      cache_hits: stats.cacheHits,
      cache_misses: stats.cacheMisses,
      cache_writes: stats.cacheWrites,
      smart_skipped: stats.smartSkipped,
      ai_elapsed_ms: Math.round(stats.aiElapsedMs),
      ai_tiles: stats.aiTiles,
      texture_classes: stats.classes,
      detail_quality: state.detailQuality,
      detail_cnn_runs: stats.detailCnnRuns,
      detail_pixels: stats.detailPixels,
      materials: stats.materials,
      average_quality_score: stats.qualityScoreCount ? Number((stats.qualityScoreSum/stats.qualityScoreCount).toFixed(1)) : null,
      material_map_sets: stats.materialMapSets,
      material_maps_mode: state.materialMaps,
      internal_8x_masters: stats.master8xRuns,
      failure_rejected: stats.failureRejected,
      specialized_cnn_runs: stats.specializedCnnRuns,
      specialized_cnn_rejected: stats.specializedCnnRejected,
    };
    if (ai) {
      const qualityReport=buildQualityReport(stats.qualityRows,{limit:20});
      manifest.resilience.quality_report="quality-report.json";
      await zip.add("quality-report.json", encoder.encode(JSON.stringify(qualityReport,null,2)+"\n"));
    }
    await zip.add("openrac-texture-pack.json", encoder.encode(JSON.stringify(manifest, null, 2) + "\n"));

    progress(1, 1, "Texture pack ready");
    const saved = await zip.finish();
    zip = null;

    if (!saved) {
      setMessage("Save cancelled.");
      return;
    }

    if (ai) {
      const degraded = stats.fallback + stats.original + stats.unreadable;
      const summary = [
        `Saved ${saved}.`,
        `${stats.ai}/${textures.length} output textures used Real-ESRGAN in ${stats.aiRuns} unique AI runs`,
        stats.duplicateTextures ? `${stats.duplicateTextures} exact duplicates reused; ${stats.duplicateTextures} repeated AI passes avoided` : "no exact duplicates found",
        stats.cacheHits ? `${stats.cacheHits} unique sources restored from persistent AI cache` : "",
        stats.smartSkipped ? `${stats.smartSkipped} transparent/uniform outputs bypassed Real-ESRGAN losslessly` : "",
        stats.cacheWrites ? `${stats.cacheWrites} new AI results cached for future runs` : "",
        stats.aiRuns && stats.aiElapsedMs ? `AI compute ${(stats.aiElapsedMs / 1000).toFixed(1)}s · ${(stats.aiElapsedMs / stats.aiRuns).toFixed(0)}ms per unique source · ${stats.aiTiles} tiles` : "",
        `classes: ${stats.classes.diffuse} diffuse · ${stats.classes.ui} UI · ${stats.classes.sky} sky · ${stats.classes.normal} normal · ${stats.classes.mask} mask`,
        stats.detailCnnRuns ? `detail CNN used on ${stats.detailCnnRuns} unique sources · ${stats.detailPixels} agreement-gated detail pixels` : "",
        stats.qualityScoreCount ? `average quality score ${(stats.qualityScoreSum/stats.qualityScoreCount).toFixed(1)}/100` : "",
        stats.materialMapSets ? `${stats.materialMapSets} material sidecar sets generated` : "",
        stats.master8xRuns ? `${stats.master8xRuns} important assets used selective 8× internal masters` : "",
        stats.failureRejected ? `${stats.failureRejected} outputs were rejected by automatic failure detection` : "",
        stats.specializedCnnRuns ? `${stats.specializedCnnRuns} material-specific refinement passes accepted` : "",
        stats.specializedCnnRejected ? `${stats.specializedCnnRejected} material-specific passes rejected by QA` : "",
        stats.duplicateScanUnverified ? `${stats.duplicateScanUnverified} duplicate candidates could not be pre-verified and were processed separately` : "",
        stats.retried ? `${stats.retried} recovered after a retry` : "",
        stats.fallback ? `${stats.fallback} used safe 4× fallback` : "",
        stats.original ? `${stats.original} kept original pixels` : "",
        stats.unreadable ? `${stats.unreadable} unreadable textures were skipped` : "",
        `restored ${stats.stars} stars/tiny lights and ${stats.microdetails} microdetails`,
        degraded ? "The pack is still valid; degraded textures did not abort the run." : "No texture needed a degraded fallback.",
        "Add the ZIP through Mods → Add a mod.",
      ].filter(Boolean).join(" · ");
      setMessage(summary, false);
    } else {
      setMessage(`Saved ${saved}. Add the ZIP through Mods → Add a mod.`);
    }
  } catch (error) {
    if (zip) await zip.cancel().catch(() => undefined);
    const text = error instanceof Error ? error.message : String(error);
    setMessage(`Pack output stopped safely: ${text}. No half-finished ZIP was kept.`, true);
  } finally {
    setBusy(false);
  }
}

function render() {
  content.replaceChildren();

  const prepareCard = el("section", undefined, "panel prepare-panel");
  const left = el("div");
  left.append(el("div", "AI GRAPHICS", "eyebrow"));
  left.append(
    el("p", textures.length ? `Ready for ${textures.length} saved texture${textures.length === 1 ? "" : "s"}.` : "No saved textures are ready yet.", "lead"),
    el("p", "Fail-safe Real-ESRGAN: preflight, retry, session reset, 4× fallback and original-texture fallback are automatic per texture.", "muted"),
  );
  const prepareButton = el("button", "Prepare AI graphics", "primary");
  prepareButton.onclick = () => void createPack({ai: true});
  prepareCard.append(left, prepareButton);
  const progressWrap = el("div", undefined, "progress span");
  progressWrap.append(el("div", "Ready.", "progress-label"));
  progressWrap.firstChild.id = "progress-text";
  const track = el("div", undefined, "progress-track");
  const bar = el("div", undefined, "progress-bar");
  bar.id = "progress-bar";
  track.append(bar); progressWrap.append(track); prepareCard.append(progressWrap); content.append(prepareCard);

  const general = el("section", undefined, "panel");
  general.append(el("div", "AI ASSET ENHANCEMENT", "eyebrow"));

  const profile = settingRow("AI asset profile", "Uses the same fork-style post-processing strengths after Real-ESRGAN reconstruction.");
  profile.control.append(select([
    ["faithful", "Faithful · original look"],
    ["balanced", "Balanced · recommended"],
    ["enhanced", "Maximum detail"],
  ], state.aiMode, async (value) => { state.aiMode = value; await savePrefs(); }));
  general.append(profile.row);

  const detailRow = settingRow(
    "Detail reconstruction",
    "Auto selects Current/High/Max per texture; detail comes from source structure and CNN context, not extra sharpening.",
  );
  detailRow.control.append(select([
    ["auto", "Auto · per texture"],
    ["standard", "Current look · fastest"],
    ["high", "High detail"],
    ["max", "Max detail · most context"],
  ], state.detailQuality, async (value) => {
    state.detailQuality = value;
    await savePrefs();
    render();
  }));
  general.append(detailRow.row);

  const dualCnn = settingRow(
    "Second detail/fidelity CNN",
    "Runs General-x4v3 beside x4plus and injects only agreement-gated structure. Disagreement is treated as possible hallucination.",
  );
  dualCnn.control.append(toggle(state.detailCnn, "Second detail CNN", async(value)=>{
    state.detailCnn=value;await savePrefs();render();
  }));
  general.append(dualCnn.row);

  const colorLock = settingRow(
    "Preserve source colour",
    "Locks chroma toward the original texture while keeping CNN luminance/detail, preventing richer detail from changing the art direction.",
  );
  colorLock.control.append(toggle(state.sourceColorLock, "Preserve source colour", async(value)=>{
    state.sourceColorLock=value;await savePrefs();render();
  }));
  general.append(colorLock.row);

  const master8x = settingRow(
    "Selective 8× internal master",
    "Important Max-detail character, weapon, boss and key terrain assets reconstruct at 8× internally, then downsample to the normal 4× texture pack.",
  );
  master8x.control.append(toggle(state.master8x, "Selective 8× master", async(value)=>{
    state.master8x=value;await savePrefs();render();
  }));
  general.append(master8x.row);

  const guard = settingRow(
    "Quality guard",
    "Scores colour drift, luminance drift, alpha, CNN agreement and excessive edge gain; suspicious outputs are reported.",
  );
  guard.control.append(toggle(state.qualityGuard, "Quality guard", async(value)=>{
    state.qualityGuard=value;await savePrefs();render();
  }));
  general.append(guard.row);

  const materialMaps = settingRow(
    "Enhanced material maps",
    "Generates Normal/Roughness/Height/AO/Emissive sidecars. Requires an OpenRAC build with Materials/<hash> sidecar support; keep Off for today's stock launcher.",
  );
  materialMaps.control.append(select([
    ["off","Off · stock-compatible"],
    ["key","Key materials · characters/weapons/world"],
    ["all","All eligible diffuse materials"],
  ], state.materialMaps, async(value)=>{
    state.materialMaps=value;await savePrefs();render();
  }));
  general.append(materialMaps.row);

  const acceleration = settingRow(
    "AI acceleration",
    "Auto uses WebGPU first and falls back to WASM if the OpenRAC WebView or GPU backend is unavailable.",
  );
  acceleration.control.append(select([
    ["auto", "Auto · WebGPU → WASM"],
    ["webgpu", "WebGPU · GPU only"],
    ["wasm", "WASM · CPU only"],
  ], state.aiBackend, async (value) => {
    state.aiBackend = value;
    aiReady = null;
    await savePrefs();
    render();
  }));
  general.append(acceleration.row);

  const cacheRow = settingRow(
    "Persistent AI cache",
    "Stores completed 4× AI results locally in the OpenRAC WebView so retries and later exports can skip Real-ESRGAN.",
  );
  cacheRow.control.append(toggle(state.persistentCache, "Persistent AI cache", async (value) => {
    state.persistentCache = value;
    await savePrefs();
    if (value) {
      await trimCache(Math.max(256, state.cacheBudgetMb) * 1024 * 1024);
      cacheState = await cacheInfo();
    }
    render();
  }));
  general.append(cacheRow.row);

  const cacheBudget = settingRow(
    "AI cache budget",
    cacheState.available
      ? `${cacheState.entries} cached results · ${(cacheState.total / 1024 / 1024).toFixed(0)} MB currently used`
      : "Cache availability is detected at runtime; unsupported WebViews continue without it.",
  );
  cacheBudget.control.append(select([
    [512, "512 MB"],
    [1024, "1 GB"],
    [2048, "2 GB"],
    [4096, "4 GB"],
  ], state.cacheBudgetMb, async (value) => {
    state.cacheBudgetMb = Number(value);
    await savePrefs();
    await trimCache(state.cacheBudgetMb * 1024 * 1024);
    cacheState = await cacheInfo();
    render();
  }));
  general.append(cacheBudget.row);

  const micro = settingRow("Preserve original micro-detail", "Restores source residual detail after the neural pass instead of letting the model smooth it away.");
  micro.control.append(toggle(state.preserveMicrodetail, "Preserve original micro-detail", async (value) => {
    state.preserveMicrodetail = value; await savePrefs(); render();
  }));
  general.append(micro.row);

  const stars = settingRow("Preserve stars & tiny lights", "Protects tiny bright stars, windows and emissive dots that super-resolution models can classify as noise.");
  stars.control.append(toggle(state.preserveStars, "Preserve stars and tiny lights", async (value) => {
    state.preserveStars = value; await savePrefs(); render();
  }));
  general.append(stars.row);
  content.append(general);

  const safety = el("section", undefined, "panel");
  safety.append(el("div", "FAIL-SAFE", "eyebrow"));
  for (const [title, description, badge] of [
    ["Preflight", "Runs one fixed 128×128 inference before opening the output pack.", "On"],
    ["Exact duplicate check", "Same-size candidates are fingerprinted and confirmed byte-for-byte; identical PNGs are upscaled only once.", "On"],
    ["Dual-CNN agreement", "x4plus reconstruction is enriched only where the General-x4v3 fidelity CNN agrees; disagreement suppresses detail injection.", "On"],
    ["Adaptive material routing", "Weapon/character/terrain/stone/metal/fabric/glass/energy/sky classes tune detail gain conservatively.", "On"],
    ["Adaptive texture classes", "UI stays conservative; normal/mask maps use technical-safe upscaling; world/sky textures use CNN detail reconstruction.", "On"],
    ["Lossless trivial bypass", "Fully transparent and exactly uniform textures skip Real-ESRGAN and are enlarged directly.", "On"],
    ["Per-texture retry", "If ONNX fails, the session is released and rebuilt once.", "1 retry"],
    ["Automatic fallback", "If AI still fails, that texture uses deterministic 4× scaling.", "4×"],
    ["Last-resort original", "If even fallback scaling fails, the original PNG is kept instead of aborting the pack.", "Safe"],
  ]) {
    const row = settingRow(title, description);
    row.control.append(el("span", badge, "status-ok"));
    safety.append(row.row);
  }
  content.append(safety);

  const assets = el("section", undefined, "panel");
  assets.append(el("div", "OPENRAC ASSETS", "eyebrow"));
  const source = settingRow("Saved textures", textures.length
    ? `${textures.length} unique texture${textures.length === 1 ? "" : "s"} detected for ${info.packId}.`
    : "Use Models and textures → Save the game's textures while you play, then return here.");
  const refresh = el("button", "Refresh", "ghost");
  refresh.onclick = () => void scan().catch((error) => setMessage(String(error), true));
  source.control.append(refresh); assets.append(source.row);

  const backend = settingRow("AI backend", aiReady
    ? `${aiReady.model} · ${aiReady.backend}${aiReady.fallbackReason ? ` · WebGPU fallback: ${aiReady.fallbackReason}` : ""}`
    : "Bundled Real-ESRGAN x4plus · Auto tries WebGPU first, then optimized WASM.");
  backend.control.append(el("span", "Standard launcher", "status-ok"));
  assets.append(backend.row);
  assets.append(el("p",
    "Exact-content duplicates are reused before AI. Only output/save failures stop the complete run; individual decode, inference or scaling problems stay isolated.",
    "info-note"));
  content.append(assets);

  const advanced = document.createElement("details");
  advanced.className = "panel advanced";
  const summary = el("summary"); summary.append(el("span", "ADVANCED"), el("span", "⌄", "chevron")); advanced.append(summary);
  const body = el("div", undefined, "advanced-body");

  const scale = settingRow("Non-AI fallback", "Fast browser scaling for testing or devices where the neural model is too slow.");
  scale.control.append(segmented([[2, "2x"], [4, "4x Ultra"]], state.scale, async (value) => {
    state.scale = value; await savePrefs(); render();
  }));
  body.append(scale.row);

  const edge = settingRow("Fallback edge preservation", "Keeps hard HUD and font edges crisp in the non-AI path.");
  edge.control.append(toggle(state.edgePreserving, "Fallback edge preservation", async (value) => {
    state.edgePreserving = value; await savePrefs(); render();
  }));
  body.append(edge.row);

  const ui = settingRow("Interface textures", "Also includes HUD, menus, fonts and other saved 2D textures.");
  ui.control.append(toggle(state.includeInterface, "Interface textures", async (value) => {
    state.includeInterface = value; updateTextures(); await savePrefs(); render();
  }));
  body.append(ui.row);

  const fallbackButton = el("button", "Export non-AI fallback pack", "ghost advanced-action");
  fallbackButton.onclick = () => void createPack({ai: false});
  body.append(fallbackButton);

  const clearCacheButton = el("button", "Clear persistent AI cache", "ghost advanced-action");
  clearCacheButton.onclick = async () => {
    const ok = await clearAiCache();
    cacheState = await cacheInfo();
    setMessage(ok ? "Persistent AI cache cleared." : "Persistent AI cache could not be cleared.", !ok);
    render();
  };
  body.append(clearCacheButton);
  body.append(el("p",
    "Real-ESRGAN always receives fixed 128×128 inputs. Current look uses 8px context; High uses 16px with overlap; Max uses 24px with stronger overlap. Overlaps are feather-blended instead of hard-overwritten.",
    "muted advanced-note"));
  advanced.append(body); content.append(advanced);

  if (qualityLab) content.append(qualityLab.render());
  if (effectsEditor) {
    for (const section of effectsEditor.render()) content.append(section);
  }
}

async function start() {
  info = await controller.info();
  effectsEditor = new EffectsEditor(controller, info, setMessage);
  await effectsEditor.start();
  qualityLab = new QualityLab(controller, () => ({...state}), setMessage);
  await qualityLab.start();
  document.addEventListener("graphics-effects-change", () => render());
  document.addEventListener("graphics-quality-lab-change", () => render());
  subtitle.textContent = `${info.game} / ${info.version} · Mod 0.12.0 · adaptive standard-launcher AI`;
  const saved = await controller.storeGet("texture-preparation").catch(() => null);
  if (saved && typeof saved === "object") {
    state = {
      scale: saved.scale === 2 ? 2 : 4,
      edgePreserving: saved.edgePreserving !== false,
      includeInterface: saved.includeInterface !== false,
      aiMode: ["faithful", "balanced", "enhanced"].includes(saved.aiMode) ? saved.aiMode : "balanced",
      preserveMicrodetail: saved.preserveMicrodetail !== false,
      preserveStars: saved.preserveStars !== false,
      aiBackend: ["auto","webgpu","wasm"].includes(saved.aiBackend) ? saved.aiBackend : "auto",
      persistentCache: saved.persistentCache !== false,
      cacheBudgetMb: [512,1024,2048,4096].includes(Number(saved.cacheBudgetMb)) ? Number(saved.cacheBudgetMb) : 2048,
      detailQuality: ["auto","standard","high","max"].includes(saved.detailQuality) ? saved.detailQuality : "auto",
      detailCnn: saved.detailCnn !== false,
      sourceColorLock: saved.sourceColorLock !== false,
      qualityGuard: saved.qualityGuard !== false,
      master8x: saved.master8x !== false,
      materialMaps: ["off","key","all"].includes(saved.materialMaps) ? saved.materialMaps : "off",
    };
  }
  if (state.persistentCache) {
    await trimCache(state.cacheBudgetMb * 1024 * 1024);
    cacheState = await cacheInfo();
  }
  await scan();
  setMessage("Ready. Fail-safe standard OpenRAC AI path is available.");
}

start().catch((error) => setMessage(error instanceof Error ? error.message : String(error), true));
