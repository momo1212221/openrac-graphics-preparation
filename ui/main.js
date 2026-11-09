// SPDX-License-Identifier: GPL-3.0-or-later
import {request} from "./bridge.js";
import {ModController} from "../src/controller.js";
import {resetAiSession, warmAi, upscaleAiMasterPng} from "../src/ai-runtime.js";
import {prepareTextureFailSafe, readFailSafe} from "../src/resilience.js";
import {textureFiles, texturePackManifest, outputName, packPath, mipmapPath} from "../src/texture-pack.js";
import {upscalePng} from "../src/upscale.js";
import {ZipStream} from "../src/zip.js";
import {EffectsEditor} from "./effects.js";
import {buildDuplicatePlan} from "../src/dedup.js";
import {cacheGetBest, cacheGetLatest, cacheInfo, cacheKey, cachePut, clearAiCache, sourceDigest, trimCache} from "../src/ai-cache.js";
import {pathTextureScope} from "../src/texture-classify.js";
import {prioritizeGroups} from "../src/priority.js";
import {QualityLab} from "./quality-lab.js";
import {generateMaterialMapPngs,shouldGenerateMaterialMaps} from "../src/material-maps.js";
import {generateMipChain,shouldGenerateMipmaps} from "../src/mipmaps.js";
import {QUALITY_POLICY_VERSION,chooseBetterQuality,evaluateQuality} from "../src/quality-policy.js";
import {applyQualifiedDowngrade,qualityRecoveryProfiles,qualifiedTier} from "../src/quality-recovery.js";
import {automaticDetailQuality,refinedDetailQuality} from "../src/quality-planner.js";
import {specializedRegistryIdentity} from "../src/specialized-models.js";
import {buildQualityReport} from "../src/quality-report.js";
import {aiRunStoreKey,aiRunSignature,beginAiRun,checkpointAiRun,interruptAiRun,completeAiRun,aiRunProgress} from "../src/ai-run-state.js";
import {PauseGate} from "../src/pause-gate.js";
import {ProgressEstimator,formatDuration} from "../src/progress-estimator.js";
import {buildGeometryJob,geometryJobFilename,geometryJobIssues,modernGeometryPreset,normalizeGeometrySettings} from "../src/geometry-job.js";
import {modernGraphicsPreset} from "../src/modern-preset.js";

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
let aiRunState = null;
let activeAiRun = false;
const aiPauseGate = new PauseGate();
const aiProgressEstimator = new ProgressEstimator();
let progressTracking = false;
let pauseButton = null;
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
  materialMaps: "key",
  materialCurvature: true,
  mipmaps: "off",
  geometryProfile: "modern",
  geometryScope: "all",
  geometryShapeRefine: true,
  geometryAllowCollisionMismatch: false,
  geometryAdaptiveSubdivision: true,
  geometryAssetAwareRemesh: true,
  geometryTopologyOptimize: true,
  geometrySilhouetteRefine: true,
  geometrySilhouetteStrength: 1.0,
  geometryLodPlanning: true,
  geometryMicroDisplacement: true,
  geometryHeightSource: "auto",
  geometryDisplacementStrength: 0.8,
  geometryCreaseAngle: 0,
  geometryTriangleBudget: 0,
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
  document.querySelectorAll("button,input,select").forEach((node) => { node.disabled = value && node.dataset.runControl !== "1"; });
}

async function savePrefs() { await controller.storeSet("texture-preparation", state); }

async function exportGeometryJob() {
  if (busy) return;
  const settings=normalizeGeometrySettings({
    profile:state.geometryProfile,
    scope:state.geometryScope,
    shapeRefine:state.geometryShapeRefine,
    allowCollisionMismatch:state.geometryAllowCollisionMismatch,
    adaptiveSubdivision:state.geometryAdaptiveSubdivision,
    assetAwareRemesh:state.geometryAssetAwareRemesh,
    topologyOptimize:state.geometryTopologyOptimize,
    silhouetteRefine:state.geometrySilhouetteRefine,
    silhouetteStrength:state.geometrySilhouetteStrength,
    lodPlanning:state.geometryLodPlanning,
    microDisplacement:state.geometryMicroDisplacement,
    heightSource:state.geometryHeightSource,
    displacementStrength:state.geometryDisplacementStrength,
    creaseAngleDegrees:state.geometryCreaseAngle || null,
    triangleBudget:state.geometryTriangleBudget || null,
  });
  const job=buildGeometryJob(info,settings);
  const issues=geometryJobIssues(info,settings);
  const name=geometryJobFilename(info,settings);
  setBusy(true);
  let token=null;
  try{
    if(info?.services?.includes("graphics-preparation")){
      setMessage("Preparing geometry natively. OpenRAC exports the render meshes, refines them offline and activates the verified overrides for the next game start.");
      const result=await controller.service("ai.meshes",{
        mode:"enhanced",
        options:job.options,
      });
      if(result?.available===false){
        throw new Error("The installed launcher does not yet provide the integrated geometry backend.");
      }
      const processed=Number(result?.processed)||0;
      const discovered=Number(result?.discovered)||processed;
      const warning=issues.length ? " Review: "+issues.join("; ")+"." : "";
      setMessage(
        "Geometry ready: "+processed+" enhanced render mesh(es)"
        +(discovered ? " from "+discovered+" discovered source mesh(es)" : "")
        +". OpenRAC will load them automatically on the next game start."
        +warning
      );
      return;
    }

    token=await controller.saveStart(name,"json");
    if(!token){setMessage("Geometry job save cancelled.");return}
    await controller.saveWrite(token,encoder.encode(JSON.stringify(job,null,2)+"\n"));
    const saved=await controller.saveEnd(token,true);
    token=null;
    const warning=issues.length ? " Review: "+issues.join("; ")+"." : "";
    setMessage(
      "This launcher is too old for native geometry preparation. Saved compatibility job "+saved
      +"; run it with helper/openrac_graphics_helper.py against your OpenRAC checkout."+warning
    );
  }catch(error){
    if(token)await controller.saveEnd(token,false).catch(()=>undefined);
    setMessage("Geometry preparation failed safely: "+(error instanceof Error?error.message:String(error)),true);
  }finally{
    setBusy(false);
  }
}

const currentRunKey = () => aiRunStoreKey(info?.packId || "openrac");
const currentRunSignature = () => aiRunSignature(state);
function currentRunProgress() {
  return aiRunProgress(aiRunState, {
    packId:info?.packId,
    signature:currentRunSignature(),
    hashes:textures.map((texture)=>texture.hash),
  });
}
async function storeAiRun(next) {
  aiRunState = next;
  await controller.storeSet(currentRunKey(), next);
}
async function checkpointCurrentRun(hashes) {
  if (!aiRunState) return;
  await storeAiRun(checkpointAiRun(aiRunState, hashes));
}

async function pauseAtSafeBoundary(label) {
  if (!aiPauseGate.requested) return;
  if (pauseButton) pauseButton.textContent = "Resume AI graphics";
  if (progressTracking) aiProgressEstimator.pause();
  const snapshot=aiProgressEstimator.snapshot();
  progress(snapshot.fraction, 1, `Paused after checkpoint · ${label}`, {sampleRate:false});
  setMessage("AI preparation is paused at a completed texture boundary. The current ZIP stream and cached progress stay intact.");
  await aiPauseGate.checkpoint();
  if (progressTracking) aiProgressEstimator.resume();
  if (pauseButton) pauseButton.textContent = "Pause AI graphics";
}

window.addEventListener("beforeunload", (event) => {
  if (!activeAiRun) return;
  event.preventDefault();
  event.returnValue = "";
});

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

function progress(done, total, label, {sampleRate=true}={}) {
  const text = document.querySelector("#progress-text");
  const bar = document.querySelector("#progress-bar");
  const percentNode = document.querySelector("#progress-percent");
  const etaNode = document.querySelector("#progress-eta");
  const elapsedNode = document.querySelector("#progress-elapsed");
  const rateNode = document.querySelector("#progress-rate");
  const safeTotal=Math.max(1,Number(total)||1);
  const fraction=Math.max(0,Math.min(1,Number(done)/safeTotal||0));

  if (text) text.textContent = label;
  if (bar) bar.style.width = `${(fraction*100).toFixed(1)}%`;

  if (progressTracking) {
    const snapshot=aiProgressEstimator.update(done,safeTotal,{sampleRate});
    if(percentNode)percentNode.textContent=`${snapshot.percent.toFixed(snapshot.percent<10?1:0)}%`;
    if(etaNode)etaNode.textContent=snapshot.fraction>=1
      ? "Done"
      : snapshot.etaMs===null
        ? "Calculating…"
        : `~${formatDuration(snapshot.etaMs,{compact:true})} left`;
    if(elapsedNode)elapsedNode.textContent=formatDuration(snapshot.elapsedMs,{compact:true});
    if(rateNode)rateNode.textContent=snapshot.unitsPerMinute
      ? `${snapshot.unitsPerMinute.toFixed(snapshot.unitsPerMinute<10?1:0)} textures/min`
      : "—";
  } else {
    if(percentNode)percentNode.textContent=`${(fraction*100).toFixed(fraction<.1?1:0)}%`;
    if(etaNode)etaNode.textContent=activeAiRun?"Starts with AI…":"—";
    if(elapsedNode)elapsedNode.textContent="—";
    if(rateNode)rateNode.textContent="—";
  }
}

async function createPack({ai, cacheOnly=false}) {
  if (busy) return;
  if (!textures.length) {
    setMessage("No saved OpenRAC textures found. Enable texture dumping in Models and textures, play the game, then return here.", true);
    return;
  }

  setBusy(true);
  if (ai && !cacheOnly) activeAiRun = true;
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
    mipmapSets:0,
    mipmapLevels:0,
    master8xRuns:0,
    failureRejected:0,
    specializedCnnRuns:0,
    specializedCnnRejected:0,
    qualityDowngraded:0,
    qualityRecoveryAttempts:0,
    qualityRecovered:0,
    qualityRows:[],
    materialQualityRows:[],
  };

  try {
    let specializedFingerprint="none";
    if (cacheOnly) {
      progress(0, 1, "Cached AI pass · locating the latest prepared texture for each source…");
    } else if (ai) {
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

    const suffix = ai
      ? (cacheOnly ? "ai-cached-4x-materials" : `ai-${state.aiMode}-4x`)
      : `${state.scale}x`;
    if (ai && !cacheOnly) {
      const previous=currentRunProgress();
      if (previous.compatible && previous.completed>0) {
        setMessage(
          state.persistentCache
            ? `Existing AI progress detected: ${previous.completed}/${previous.total} textures already prepared. Cached results will be verified and reused automatically.`
            : `Existing AI progress detected: ${previous.completed}/${previous.total} textures were prepared before, but persistent cache is disabled, so missing results will be recomputed.`,
        );
      }
    }
    const token = await controller.saveStart(outputName(info, suffix), "zip");
    if (!token) { setMessage("Save cancelled."); return; }
    zip = new ZipStream(controller, token);
    if (ai && !cacheOnly) {
      await storeAiRun(beginAiRun(aiRunState,{
        packId:info.packId,
        signature:currentRunSignature(),
        hashes:textures.map((texture)=>texture.hash),
      }));
      aiProgressEstimator.reset(workGroups.length);
      progressTracking=true;
      progress(0,1,`AI · 0/${workGroups.length} unique textures · estimating remaining time…`,{sampleRate:false});
    } else if (cacheOnly) {
      progressTracking=true;
      aiProgressEstimator.reset(workGroups.length);
      progress(0,1,`Cached material rebuild · 0/${workGroups.length} unique textures`,{sampleRate:false});
    }

    let included = 0;
    for (let groupIndex = 0; groupIndex < workGroups.length; groupIndex++) {
      const group = workGroups[groupIndex];
      const primary = group.members[0];
      const baseLabel = ai
        ? `unique ${groupIndex + 1}/${workGroups.length} · ${group.members.length} output${group.members.length === 1 ? "" : "s"} · ${primary.hash}`
        : `${groupIndex + 1}/${workGroups.length} · ${primary.hash}`;
      let source = null;
      let readError = null;
      let groupSampleRate = ai;

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
        progress(groupIndex + 1, workGroups.length, `Skipped unreadable source group · ${baseLabel}`, {sampleRate:false});
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
          qualityPolicyVersion: QUALITY_POLICY_VERSION,
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
          const qualities = state.detailQuality === "auto"
            ? [effectiveDetailQuality, "max", "high", "standard"]
            : [effectiveDetailQuality];
          const cached = cacheOnly
            ? await cacheGetLatest(digest)
            : await cacheGetBest(digest, cacheOptions, qualities);
          if (cached?.hit) {
            key=cached.key;
            const hit=cached.hit;
            stats.cacheHits++;
            prepared = {
              bytes: hit.bytes,
              strategy: "ai",
              attempts: 0,
              stars: hit.stars,
              microdetails: hit.microdetails,
              textureClass: hit.textureClass,
              material: hit.material,
              detailQuality: hit.detailQuality || cached.detailQuality,
              metrics: hit.metrics,
              classification: hit.classification,
              materialInfo: hit.materialInfo,
              failures: hit.failures,
              masterScale: hit.masterScale,
              internalMaster: hit.internalMaster,
              specializedCnnUsed:hit.specializedCnnUsed,
              specializedRejected:hit.specializedRejected,
              specializedModelSha:hit.specializedModelSha,
              alphaEdges:hit.alphaEdges,
              errors: [],
              cached: true,
            };
            groupSampleRate=false;
            progress((groupIndex + .82) / workGroups.length, 1, `${cacheOnly ? "Latest AI cache hit" : "Cache hit"} · ${baseLabel} · preparing sidecars/output`, {sampleRate:false});
          } else {
            stats.cacheMisses++;
          }
        }

        if (!prepared && cacheOnly) {
          // Never run either CNN in this mode. A deterministic fallback is safe for entries that
          // were not cacheable in the previous pass; all cached AI results remain byte-identical.
          prepared = {
            bytes: await upscalePng(source,4,true),
            strategy:"fallback",
            attempts:0,
            stars:0,
            microdetails:0,
            backend:"cache-only-fallback",
            skipped:true,
            skipReason:"cache-miss-no-ai-rerun",
            errors:[],
            cached:false,
          };
          stats.warnings.push({
            hashes:group.members.map((member)=>member.hash),
            strategy:"cache-only-miss",
            error:"No persistent AI cache entry exists for this source texture; deterministic 4x fallback used and no AI inference was run.",
          });
          groupSampleRate=false;
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
            const fraction = (groupIndex + (tile / totalTiles) * .82) / workGroups.length;
            progress(fraction, 1, `AI · ${baseLabel} · tile ${tile}/${totalTiles}`);
          }),
          resetAi: resetAiSession,
          fallback: () => upscalePng(source, 4, true),
          retries: 1,
        });

        if (
          state.qualityGuard && prepared.strategy === "ai" && !prepared.skipped &&
          prepared.metrics?.score !== undefined
        ) {
          const downgrade=applyQualifiedDowngrade(prepared);
          if(downgrade.changed){
            prepared={...prepared,...downgrade.result};
            stats.qualityDowngraded++;
            stats.warnings.push({
              hashes:group.members.map((member)=>member.hash),
              strategy:"quality-tier-downgraded",
              from:downgrade.from,to:downgrade.to,metrics:prepared.metrics,
            });
          }
        }

        if (
          state.detailQuality === "auto" && !override.quality &&
          prepared.strategy === "ai" && !prepared.skipped
        ) {
          const currentDetailQuality = prepared.detailQuality || effectiveDetailQuality;
          const refinedQuality = refinedDetailQuality(prepared, currentDetailQuality);
          const promotionOnly = currentDetailQuality === "high" && refinedQuality === "max";
          if (promotionOnly) {
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
              const refinedPolicy = evaluateQuality(refined.metrics, refined);
              const promoted = refinedPolicy.verdict === "pass" &&
                (refined.metrics?.score ?? 0) >= (prepared.metrics?.score ?? 0) - 2;
              const selected = promoted ? refined : prepared;
              if (selected === refined) {
                prepared = {...prepared,...refined,strategy:"ai",attempts:prepared.attempts,errors:prepared.errors,cached:false};
                stats.warnings.push({
                  hashes:group.members.map((member)=>member.hash),
                  strategy:refinedQuality === "max" ? "quality-promoted" : "quality-refined",
                  from:currentDetailQuality,to:refinedQuality,metrics:refined.metrics,
                });
              }
            } catch {}
          }
        }

        if (
          state.qualityGuard && prepared.strategy === "ai" && !prepared.cached && !prepared.skipped &&
          prepared.metrics?.score !== undefined && evaluateQuality(prepared.metrics, prepared).retry
        ) {
          const profiles=qualityRecoveryProfiles(prepared,state);
          for(const profile of profiles){
            try{
              stats.qualityRecoveryAttempts++;
              const recovered=await upscaleAiMasterPng(source,{
                ...profile,
                backend:state.aiBackend,
                texturePaths,
                textureClassOverride:cacheOptions.textureClassOverride,
                materialOverride:cacheOptions.materialOverride,
              });
              const tier=qualifiedTier(recovered,"standard");
              if(!tier)continue;
              prepared={
                ...prepared,...recovered,
                detailQuality:tier,
                strategy:"ai",
                attempts:prepared.attempts,
                errors:prepared.errors,
                cached:false,
                qualityRecoveredFrom:prepared.detailQuality,
              };
              stats.qualityRecovered++;
              stats.warnings.push({
                hashes:group.members.map((member)=>member.hash),
                strategy:"quality-recovered",
                profile,
                metrics:recovered.metrics,
              });
              break;
            }catch{}
          }
        }

        if (state.qualityGuard && prepared.metrics?.score!==undefined) {
          const policy=evaluateQuality(prepared.metrics,prepared);
          if((policy.verdict!=="pass" || prepared.failures?.ok===false) && prepared.strategy==="ai" && !prepared.cached && !prepared.skipped){
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
            alphaEdges:prepared.alphaEdges,
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
        const materialMode = cacheOnly ? "all" : state.materialMaps;
        if (
          materialMode !== "off" &&
          shouldGenerateMaterialMaps(prepared.textureClass, prepared.material, materialMode)
        ) {
          try {
            progress((groupIndex + .82) / workGroups.length, 1, `Material maps · ${baseLabel}`, {sampleRate:false});
            generatedMaps = await generateMaterialMapPngs(prepared.bytes, prepared.material || "generic", {curvature:state.materialCurvature});
            stats.materialMapSets += group.members.length;
            for(const member of group.members){
              stats.materialQualityRows.push({
                hash:member.hash,path:member.path,material:prepared.material,quality:generatedMaps.quality,
                pbrCalibration:generatedMaps.pbrCalibration,pbrValidation:generatedMaps.pbrValidation,
                heightPipeline:generatedMaps.heightPipeline,
                albedoDelight:generatedMaps.albedoDelight,albedoValidation:generatedMaps.albedoValidation,
              });
            }
            if(generatedMaps.quality?.ok===false){
              stats.warnings.push({
                hashes:group.members.map((member)=>member.hash),
                strategy:"material-map-quality",
                quality:generatedMaps.quality,
              });
            }
          } catch (error) {
            stats.warnings.push({
              hashes:group.members.map((member)=>member.hash),
              strategy:"material-map-failed",
              error:error instanceof Error?error.message:String(error),
            });
          }
          progress((groupIndex + .90) / workGroups.length, 1, `Material maps complete · ${baseLabel}`, {sampleRate:groupSampleRate});
        }
        let generatedMips = null;
        if (
          state.mipmaps !== "off" &&
          shouldGenerateMipmaps(prepared.textureClass, prepared.material, state.mipmaps)
        ) {
          try {
            progress((groupIndex + .90) / workGroups.length, 1, `Mipmaps · ${baseLabel}`, {sampleRate:false});
            generatedMips = await generateMipChain(prepared.bytes,{maxLevels:6,minSize:1});
            stats.mipmapSets += group.members.length;
            stats.mipmapLevels += generatedMips.levels.length * group.members.length;
          } catch (error) {
            stats.warnings.push({
              hashes:group.members.map((member)=>member.hash),
              strategy:"mipmap-generation-failed",
              error:error instanceof Error?error.message:String(error),
            });
          }
          progress((groupIndex + .94) / workGroups.length, 1, `Mipmaps complete · ${baseLabel}`, {sampleRate:groupSampleRate});
        }
        const writeFraction=generatedMips?.94:(generatedMaps?.90:.82);
        progress((groupIndex + writeFraction) / workGroups.length, 1, `Writing pack · ${baseLabel}`, {sampleRate:false});
        for (const member of group.members) {
          await zip.add(packPath(member), prepared.bytes);
          if (generatedMips) {
            const root = `Mipmaps/${member.hash}/`;
            for (const level of generatedMips.levels) {
              await zip.add(mipmapPath(member,level.level),level.bytes);
            }
            const mipMeta = {
              format:1,
              generator:"Graphics preparation 0.21.1",
              sourceHash:member.hash,
              sourceWidth:generatedMips.sourceWidth,
              sourceHeight:generatedMips.sourceHeight,
              hardCutout:generatedMips.hardCutout,
              targetAlphaCoverage:generatedMips.targetAlphaCoverage,
              levels:generatedMips.levels.map((level)=>({
                level:level.level,width:level.width,height:level.height,
                alphaCoverage:level.alphaCoverage,alphaBias:level.alphaBias,
              })),
            };
            await zip.add(root+"mipmaps.json",encoder.encode(JSON.stringify(mipMeta,null,2)+"\n"));
          }
          if (generatedMaps) {
            const root = `Materials/${member.hash}/`;
            await zip.add(root+"albedo.png", generatedMaps.albedo);
            await zip.add(root+"normal.png", generatedMaps.normal);
            await zip.add(root+"roughness.png", generatedMaps.roughness);
            await zip.add(root+"height.png", generatedMaps.height);
            await zip.add(root+"ao.png", generatedMaps.ao);
            await zip.add(root+"emissive.png", generatedMaps.emissive);
            await zip.add(root+"specular.png", generatedMaps.specular);
            await zip.add(root+"metallic.png", generatedMaps.metallic);
            await zip.add(root+"cavity.png", generatedMaps.cavity);
            if (generatedMaps.curvature) await zip.add(root+"curvature.png", generatedMaps.curvature);
            await zip.add(root+"edgewear.png", generatedMaps.edgewear);
            const meta = {
              format:1,
              generator:"Graphics preparation 0.21.1",
              material:prepared.material || "generic",
              textureClass:prepared.textureClass || "diffuse",
              emissivePixels:generatedMaps.emissivePixels,
              pbrCalibration:generatedMaps.pbrCalibration,
              pbrValidation:generatedMaps.pbrValidation,
              albedoDelight:generatedMaps.albedoDelight,
              albedoValidation:generatedMaps.albedoValidation,
              heightPipeline:generatedMaps.heightPipeline,
              quality:generatedMaps.quality,
              sourceHash:member.hash,
            };
            await zip.add(root+"material.json", encoder.encode(JSON.stringify(meta,null,2)+"\n"));
          }
          included++;
        }
        groupSampleRate=groupSampleRate && prepared.strategy==="ai" && !prepared.cached && !prepared.skipped;
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
      if (ai) {
        progress(groupIndex + 1, workGroups.length, `Complete · ${baseLabel}`, {sampleRate:groupSampleRate});
        if (!cacheOnly) {
          await checkpointCurrentRun(group.members.map((member)=>member.hash));
          await pauseAtSafeBoundary(baseLabel);
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
      material_maps_mode: cacheOnly ? "all-from-last-ai-cache" : state.materialMaps,
      ai_cache_only_material_rebuild: cacheOnly,
      material_curvature: state.materialCurvature,
      mipmap_sets: stats.mipmapSets,
      mipmap_levels: stats.mipmapLevels,
      mipmaps_mode: state.mipmaps,
      internal_8x_masters: stats.master8xRuns,
      failure_rejected: stats.failureRejected,
      specialized_cnn_runs: stats.specializedCnnRuns,
      specialized_cnn_rejected: stats.specializedCnnRejected,
      quality_tier_downgraded: stats.qualityDowngraded,
      quality_recovery_attempts: stats.qualityRecoveryAttempts,
      quality_recovered: stats.qualityRecovered,
    };
    if (ai) {
      const qualityReport=buildQualityReport(stats.qualityRows,{limit:20,materialMaps:stats.materialQualityRows});
      manifest.resilience.quality_report="quality-report.json";
      await zip.add("quality-report.json", encoder.encode(JSON.stringify(qualityReport,null,2)+"\n"));
    }
    await zip.add("openrac-texture-pack.json", encoder.encode(JSON.stringify(manifest, null, 2) + "\n"));

    progress(1, 1, "Texture pack ready", {sampleRate:false});
    const saved = await zip.finish();
    zip = null;

    if (!saved) {
      if (ai && !cacheOnly && aiRunState) await storeAiRun(interruptAiRun(aiRunState));
      setMessage("Save cancelled. Completed AI textures remain cached and can be reused next time.");
      return;
    }

    if (ai && !cacheOnly && aiRunState) await storeAiRun(completeAiRun(aiRunState));

    if (ai) {
      const degraded = stats.fallback + stats.original + stats.unreadable;
      if (cacheOnly) {
        const misses=stats.warnings.filter((row)=>row.strategy==="cache-only-miss").length;
        setMessage(
          `Saved ${saved}. Reused ${stats.cacheHits} cached AI source(s) and generated ${stats.materialMapSets} material sidecar set(s) without running AI`
          + (misses ? `; ${misses} uncached source group(s) used deterministic 4x fallback` : "")
          + ". Add this ZIP through Mods → Add a mod. Your previous AI run state and cache were not replaced."
        );
        return;
      }
      const qualitySummary=buildQualityReport(stats.qualityRows,{limit:20,materialMaps:stats.materialQualityRows});
      const weakestMaterial=qualitySummary.materialBreakdown?.[0]||null;
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
        qualitySummary.scored ? `${qualitySummary.tiers.standard.rate}% ≥90 Standard · ${qualitySummary.tiers.high.rate}% ≥94 High · ${qualitySummary.tiers.max.rate}% ≥97 Max` : "",
        weakestMaterial ? `weakest material: ${weakestMaterial.material} · ${weakestMaterial.standardRate}% ≥90 · avg ${weakestMaterial.average}` : "",
        stats.qualityDowngraded ? `${stats.qualityDowngraded} results kept without rerender by safe tier downgrade` : "",
        stats.qualityRecoveryAttempts ? `${stats.qualityRecoveryAttempts} material-aware quality recovery attempts` : "",
        stats.qualityRecovered ? `${stats.qualityRecovered} sub-standard results recovered back to ≥90` : "",
        stats.materialMapSets ? `${stats.materialMapSets} material sidecar sets generated` : "",
        stats.mipmapSets ? `${stats.mipmapSets} enhanced mip chains · ${stats.mipmapLevels} levels generated` : "",
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
    if (ai && !cacheOnly && aiRunState) await storeAiRun(interruptAiRun(aiRunState)).catch(()=>undefined);
    const text = error instanceof Error ? error.message : String(error);
    setMessage(`Pack output stopped safely: ${text}. Completed AI textures remain cached for resume; no half-finished ZIP was kept.`, true);
  } finally {
    if (ai) {
      if (!cacheOnly) activeAiRun = false;
      progressTracking = false;
      aiPauseGate.reset();
      if (pauseButton) {
        pauseButton.hidden = true;
        pauseButton.textContent = "Pause AI graphics";
      }
    }
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
  const runProgress=currentRunProgress();
  if (runProgress.compatible && runProgress.completed>0) {
    const runText=runProgress.status==="complete"
      ? `AI check: ${runProgress.completed}/${runProgress.total} textures were already prepared for this game/profile. A new export reuses verified cache entries.`
      : state.persistentCache
        ? `Resume available: ${runProgress.completed}/${runProgress.total} textures were already prepared before the last run stopped. Starting again continues via the persistent cache.`
        : `Previous AI progress found: ${runProgress.completed}/${runProgress.total} textures were prepared, but persistent cache is disabled. Enable it before continuing to reuse finished results.`;
    left.append(el("p",runText,runProgress.status==="complete"?"status-ok":"info-note"));
  } else if (aiRunState && !runProgress.compatible) {
    left.append(el("p","Earlier AI progress exists for this game, but with a different quality profile. Cache entries are revalidated per texture before reuse.","info-note"));
  }
  const prepareButton = el("button", "Prepare AI graphics", "primary");
  prepareButton.onclick = () => {
    pauseButton.hidden = false;
    pauseButton.textContent = "Pause AI graphics";
    void createPack({ai: true});
  };
  pauseButton = el("button", "Pause AI graphics");
  pauseButton.type = "button";
  pauseButton.dataset.runControl = "1";
  pauseButton.hidden = true;
  pauseButton.onclick = () => {
    if (!activeAiRun) return;
    if (aiPauseGate.requested) {
      aiPauseGate.resume();
      pauseButton.textContent = "Pause AI graphics";
      setMessage("AI preparation resumed.");
    } else {
      aiPauseGate.request();
      pauseButton.textContent = "Pause requested…";
      setMessage("Pause requested. The current texture finishes first; pausing happens at the next safe checkpoint.");
    }
  };
  const materialReuseButton = el("button", "Add materials to last AI run");
  materialReuseButton.title = "Rebuilds the texture-pack ZIP from persistent AI results and generates Normal/Roughness/AO/Height sidecars without running AI again.";
  materialReuseButton.disabled = !state.persistentCache || cacheState.entries===0;
  materialReuseButton.onclick = () => {
    setMessage("Reusing the last persistent AI results. No Real-ESRGAN or detail-CNN inference will run; material maps are generated from those cached 4x textures.");
    void createPack({ai:true,cacheOnly:true});
  };
  const globalModernPresetButton=el("button","Modern / PS5 target");
  globalModernPresetButton.type="button";
  globalModernPresetButton.onclick=async()=>{
    state=modernGraphicsPreset(state);
    await savePrefs();
    setMessage("Modern / PS5 target applied: Enhanced AI, guarded Auto detail, selective 8x masters, full eligible material maps/mipmaps and adaptive collision-safe geometry.");
    render();
  };
  const runButtons=el("div",undefined,"button-row");
  runButtons.append(globalModernPresetButton,prepareButton,materialReuseButton,pauseButton);
  prepareCard.append(left, runButtons);
  const progressWrap = el("div", undefined, "progress span");
  progressWrap.append(el("div", "Ready.", "progress-label"));
  progressWrap.firstChild.id = "progress-text";

  const progressMetrics=el("div",undefined,"progress-metrics");
  for(const [id,label,value] of [
    ["progress-percent","Progress","0%"],
    ["progress-eta","Remaining","—"],
    ["progress-elapsed","Elapsed","—"],
    ["progress-rate","Speed","—"],
  ]){
    const item=el("div",undefined,"progress-metric");
    item.append(el("span",label),el("strong",value));
    item.lastChild.id=id;
    progressMetrics.append(item);
  }
  progressWrap.append(progressMetrics);

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
    "Auto selects Standard/High/Max per texture with strict quality targets of 90/94/97; detail comes from source structure and CNN context, not extra sharpening.",
  );
  detailRow.control.append(select([
    ["auto", "Auto · per texture"],
    ["standard", "Standard · quality ≥90"],
    ["high", "High · quality ≥94"],
    ["max", "Max · quality ≥97"],
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
    "Enforces Standard ≥90, High ≥94 and Max ≥97 plus fidelity, CNN-confidence and hallucination limits. Failed AI output is retried conservatively, then rejected to safe 4× fallback.",
  );
  guard.control.append(toggle(state.qualityGuard, "Quality guard", async(value)=>{
    state.qualityGuard=value;await savePrefs();render();
  }));
  general.append(guard.row);

  const materialMaps = settingRow(
    "Enhanced material maps",
    "Production path: Upscaled Diffuse → Albedo Cleanup → Coarse/Mid/Micro Height → Height Merge → Normal From Height → AO/Roughness and optional Curvature. Requires Materials/<hash> renderer support.",
  );
  materialMaps.control.append(select([
    ["off","Off · stock-compatible"],
    ["key","Key materials · characters/weapons/world"],
    ["all","All eligible diffuse materials"],
  ], state.materialMaps, async(value)=>{
    state.materialMaps=value;await savePrefs();render();
  }));
  general.append(materialMaps.row);

  const curvature = settingRow(
    "Curvature sidecar",
    "Optional signed curvature derived after Height Merge. Useful for enhanced edge/cavity effects; turn it off to save processing and pack space.",
  );
  curvature.control.append(toggle(state.materialCurvature, "Curvature sidecar", async(value)=>{
    state.materialCurvature=value;await savePrefs();render();
  }));
  general.append(curvature.row);

  const mipmaps = settingRow(
    "Enhanced mipmaps",
    "Builds alpha-stable distance mip chains from the final 4× texture. Intended for the enhanced renderer; keep Off for the stock launcher.",
  );
  mipmaps.control.append(select([
    ["off","Off · stock-compatible"],
    ["key","Key materials only"],
    ["all","All eligible diffuse/sky textures"],
  ], state.mipmaps, async(value)=>{
    state.mipmaps=value;await savePrefs();render();
  }));
  general.append(mipmaps.row);

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

  const geometry = el("section", undefined, "panel");
  geometry.append(el("div", "3D GEOMETRY ENHANCEMENT", "eyebrow"));
  geometry.append(el("p",
    "Modern geometry path: adaptive subdivision spends triangles on long/curved areas, preserves hard creases, keeps UV/skinning intact and rebuilds tangent space. Geometry runs independently from the texture AI cache.",
    "info-note"));

  const modernPresetButton=el("button","Use Modern / PS5 target","primary");
  modernPresetButton.onclick=async()=>{
    const preset=modernGeometryPreset();
    state.geometryProfile=preset.profile;
    state.geometryScope=preset.scope;
    state.geometryShapeRefine=preset.shapeRefine;
    state.geometryAllowCollisionMismatch=preset.allowCollisionMismatch;
    state.geometryAdaptiveSubdivision=preset.adaptiveSubdivision;
    state.geometryAssetAwareRemesh=preset.assetAwareRemesh;
    state.geometryTopologyOptimize=preset.topologyOptimize;
    state.geometrySilhouetteRefine=preset.silhouetteRefine;
    state.geometrySilhouetteStrength=preset.silhouetteStrength;
    state.geometryLodPlanning=preset.lodPlanning;
    state.geometryMicroDisplacement=preset.microDisplacement;
    state.geometryHeightSource=preset.heightSource;
    state.geometryDisplacementStrength=preset.displacementStrength;
    state.geometryCreaseAngle=preset.creaseAngleDegrees||0;
    state.geometryTriangleBudget=preset.triangleBudget||0;
    await savePrefs();
    setMessage("Modern / PS5 target applied: asset-aware remesh, silhouette refinement, topology optimization, LOD planning, bounded Height micro-displacement and collision-safe gameplay surfaces.");
    render();
  };
  const presetButtons=el("div",undefined,"button-row");
  presetButtons.append(modernPresetButton);
  geometry.append(presetButtons);

  const geometryProfile = settingRow(
    "Geometry profile",
    "Modern / PS5 target is recommended: up to two adaptive passes with higher per-asset budgets and crease preservation. High/Ultra remain useful for controlled comparisons; Experimental permits stronger manual-review shape work.",
  );
  geometryProfile.control.append(select([
    ["enhanced","Enhanced · tangent-space cleanup"],
    ["high","High · 1 subdivision pass"],
    ["ultra","Ultra · up to 2 passes"],
    ["modern","Modern / PS5 target · recommended"],
    ["experimental","Experimental · manual review"],
  ],state.geometryProfile,async(value)=>{
    state.geometryProfile=value;await savePrefs();render();
  }));
  geometry.append(geometryProfile.row);

  const geometryScope = settingRow(
    "3D asset scope",
    "Choose which OpenRAC exports the helper processes. Terrain, scenery and mobys use the official Models and textures glTF round trip.",
  );
  geometryScope.control.append(select([
    ["all","All supported 3D assets"],
    ["terrain","Terrain only"],
    ["scenery","Scenery · ties + shrubs"],
    ["mobys","Mobys · characters/objects/weapons"],
  ],state.geometryScope,async(value)=>{
    state.geometryScope=value;await savePrefs();render();
  }));
  geometry.append(geometryScope.row);

  const geometryBudget = settingRow(
    "Triangle budget",
    "Caps each primitive before another 4× subdivision step. Auto uses larger budgets for terrain and tighter budgets for animated objects.",
  );
  geometryBudget.control.append(select([
    [0,"Auto · per asset type"],
    [60000,"60k triangles"],
    [120000,"120k triangles"],
    [250000,"250k triangles"],
  ],state.geometryTriangleBudget,async(value)=>{
    state.geometryTriangleBudget=Number(value)||0;await savePrefs();render();
  }));
  geometry.append(geometryBudget.row);

  const adaptiveGeometry = settingRow(
    "Adaptive subdivision",
    "Recommended. Splits globally shared edges by geometric density and curvature, so flat/dense regions do not waste the triangle budget and neighbouring triangles cannot form T-junction cracks.",
  );
  adaptiveGeometry.control.append(toggle(state.geometryAdaptiveSubdivision,"Adaptive subdivision",async(value)=>{
    state.geometryAdaptiveSubdivision=value;await savePrefs();render();
  }));
  geometry.append(adaptiveGeometry.row);

  const assetAwareRemesh = settingRow(
    "Asset-aware remesh",
    "Recommended. Classifies each primitive as Character, Weapon, Rock, Foliage, Terrain, Structure or Prop and adjusts triangle budget, edge density and silhouette priority per role.",
  );
  assetAwareRemesh.control.append(toggle(state.geometryAssetAwareRemesh,"Asset-aware remesh",async(value)=>{
    state.geometryAssetAwareRemesh=value;await savePrefs();render();
  }));
  geometry.append(assetAwareRemesh.row);

  const topologyOptimize = settingRow(
    "Triangle topology optimization",
    "Flips safe shared diagonals only when average triangle quality improves without crossing hard creases or reversing the UV orientation. This improves deformation, normals and Height displacement on the denser mesh.",
  );
  topologyOptimize.control.append(toggle(state.geometryTopologyOptimize,"Triangle topology optimization",async(value)=>{
    state.geometryTopologyOptimize=value;await savePrefs();render();
  }));
  geometry.append(topologyOptimize.row);

  const silhouetteRefine = settingRow(
    "Silhouette refinement",
    "Uses asset-specific, volume-preserving smoothing after subdivision. Rocks and static scenery can round coarse PS2 outlines more strongly; terrain and mobys remain position-locked unless visual/collision mismatch is explicitly allowed.",
  );
  silhouetteRefine.control.append(toggle(state.geometrySilhouetteRefine,"Silhouette refinement",async(value)=>{
    state.geometrySilhouetteRefine=value;await savePrefs();render();
  }));
  geometry.append(silhouetteRefine.row);

  const silhouetteStrength = settingRow(
    "Silhouette strength",
    "Scales the role-specific refinement envelope. 100% is the recommended PS5 target; this does not bypass collision locks or crease/boundary pins.",
  );
  silhouetteStrength.control.append(select([
    [0.5,"50% · conservative"],
    [0.8,"80% · subtle"],
    [1.0,"100% · recommended"],
    [1.25,"125% · stronger"],
  ],state.geometrySilhouetteStrength,async(value)=>{
    state.geometrySilhouetteStrength=Number(value)||1;await savePrefs();render();
  }));
  geometry.append(silhouetteStrength.row);

  const lodPlanning = settingRow(
    "LOD planning",
    "Builds per-asset LOD0/LOD1/LOD2 triangle targets from the actual subdivision stages. Stock OpenRAC currently imports one replacement GLB, so the plan is recorded for integration/reporting instead of pretending runtime switching already works.",
  );
  lodPlanning.control.append(toggle(state.geometryLodPlanning,"LOD planning",async(value)=>{
    state.geometryLodPlanning=value;await savePrefs();render();
  }));
  geometry.append(lodPlanning.row);

  const microDisplacement = settingRow(
    "Height micro-displacement",
    "Turns material Height into real bounded surface geometry after subdivision. Boundaries and hard creases are pinned. Terrain and mobys stay locked unless visual/collision mismatch is explicitly allowed.",
  );
  microDisplacement.control.append(toggle(state.geometryMicroDisplacement,"Height micro-displacement",async(value)=>{
    state.geometryMicroDisplacement=value;await savePrefs();render();
  }));
  geometry.append(microDisplacement.row);

  const heightSource = settingRow(
    "Height source",
    "Auto prefers Materials/<hash>/height.png from your prepared pack and falls back to a conservative Diffuse-derived height. Sidecar only never guesses missing relief.",
  );
  heightSource.control.append(select([
    ["auto","Auto · sidecar first, Diffuse fallback"],
    ["sidecar","Sidecar only · highest fidelity"],
    ["diffuse","Diffuse-derived · conservative fallback"],
  ],state.geometryHeightSource,async(value)=>{
    state.geometryHeightSource=value;await savePrefs();render();
  }));
  geometry.append(heightSource.row);

  const displacementStrength = settingRow(
    "Displacement strength",
    "Scales only inside the material safety cap. Even 100% cannot exceed the material's bounded maximum; Diffuse fallback is additionally reduced.",
  );
  displacementStrength.control.append(select([
    [0.5,"50% · conservative"],
    [0.8,"80% · recommended"],
    [1.0,"100% · material cap"],
    [1.25,"125% · aggressive"],
  ],state.geometryDisplacementStrength,async(value)=>{
    state.geometryDisplacementStrength=Number(value)||0.8;await savePrefs();render();
  }));
  geometry.append(displacementStrength.row);

  const creaseAngle = settingRow(
    "Crease preservation",
    "Prevents low-poly hard edges from being incorrectly smoothed. Auto uses stricter angles for characters/objects and a wider angle for terrain.",
  );
  creaseAngle.control.append(select([
    [0,"Auto · per asset type"],
    [45,"45° · preserve more hard edges"],
    [55,"55° · balanced"],
    [65,"65° · smoother"],
    [75,"75° · terrain-like"],
  ],state.geometryCreaseAngle,async(value)=>{
    state.geometryCreaseAngle=Number(value)||0;await savePrefs();render();
  }));
  geometry.append(creaseAngle.row);

  const shapeRefine = settingRow(
    "Shape refinement",
    "Adds a very small volume-preserving relaxation after subdivision. Modern / PS5 target enables it for safe static scenery, while terrain and mobys remain position-locked unless collision mismatch is explicitly allowed.",
  );
  shapeRefine.control.append(toggle(state.geometryShapeRefine,"Shape refinement",async(value)=>{
    state.geometryShapeRefine=value;await savePrefs();render();
  }));
  geometry.append(shapeRefine.row);

  const collisionMismatch = settingRow(
    "Allow visual/collision mismatch",
    "Experimental. When Off, moby and terrain vertices are protected even if Shape refinement is On. When On, moved gameplay surfaces are reported for collision rebuild/manual review.",
  );
  collisionMismatch.control.append(toggle(state.geometryAllowCollisionMismatch,"Allow collision mismatch",async(value)=>{
    state.geometryAllowCollisionMismatch=value;await savePrefs();render();
  }));
  geometry.append(collisionMismatch.row);

  const nativeGeometry=info?.services?.includes("graphics-preparation");
  const geometryJobButton=el("button",nativeGeometry?"Prepare Geometry":"Export Geometry Job","primary");
  geometryJobButton.onclick=()=>void exportGeometryJob();
  const geometryButtons=el("div",undefined,"button-row");
  geometryButtons.append(geometryJobButton);
  geometry.append(geometryButtons);
  geometry.append(el("p",
    nativeGeometry
      ? "OpenRAC runs the bundled geometry helper through the consented launcher service, validates the complete render-mesh result, rejects collision replacements, backs up the previous geometry and activates the new level overrides automatically for the next game start."
      : "Compatibility mode: save the Geometry Job and run helper/openrac_graphics_helper.py against your OpenRAC checkout. Current launchers use the native Prepare Geometry path instead.",
    "muted"));
  content.append(geometry);

  const safety = el("section", undefined, "panel");
  safety.append(el("div", "FAIL-SAFE", "eyebrow"));
  for (const [title, description, badge] of [
    ["Preflight", "Runs one fixed 128×128 inference before opening the output pack.", "On"],
    ["Exact duplicate check", "Same-size candidates are fingerprinted and confirmed byte-for-byte; identical PNGs are upscaled only once.", "On"],
    ["Dual-CNN agreement", "x4plus reconstruction is enriched only where the General-x4v3 fidelity CNN agrees; disagreement suppresses detail injection.", "On"],
    ["Adaptive material routing", "Weapon/character/terrain/stone/metal/fabric/glass/energy/sky classes tune detail gain conservatively.", "On"],
    ["Adaptive texture classes", "UI stays conservative; normal/mask maps use technical-safe upscaling; world/sky textures use CNN detail reconstruction.", "On"],
    ["Lossless trivial bypass", "Fully transparent and exactly uniform textures skip Real-ESRGAN and are enlarged directly.", "On"],
    ["Close protection + resume", "Closing the launcher during AI processing triggers a leave warning. Finished textures are checkpointed and reused from the persistent cache after reopening.", "On"],
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
    if (ok) {
      aiRunState=null;
      await controller.storeSet(currentRunKey(), null).catch(()=>undefined);
    }
    cacheState = await cacheInfo();
    setMessage(ok ? "Persistent AI cache and saved AI run progress cleared." : "Persistent AI cache could not be cleared.", !ok);
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
  subtitle.textContent = `${info.game} / ${info.version} · Mod 0.17.2 · adaptive standard-launcher AI`;
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
      materialMaps: ["off","key","all"].includes(saved.materialMaps) ? saved.materialMaps : "key",
      materialCurvature: saved.materialCurvature !== false,
      mipmaps: ["off","key","all"].includes(saved.mipmaps) ? saved.mipmaps : "off",
      geometryProfile: ["enhanced","high","ultra","modern","experimental"].includes(saved.geometryProfile) ? saved.geometryProfile : "modern",
      geometryScope: ["all","terrain","scenery","mobys"].includes(saved.geometryScope) ? saved.geometryScope : "all",
      geometryShapeRefine: saved.geometryShapeRefine === true,
      geometryAllowCollisionMismatch: saved.geometryAllowCollisionMismatch === true,
      geometryAdaptiveSubdivision: saved.geometryAdaptiveSubdivision !== false,
      geometryAssetAwareRemesh: saved.geometryAssetAwareRemesh !== false,
      geometryTopologyOptimize: saved.geometryTopologyOptimize !== false,
      geometrySilhouetteRefine: saved.geometrySilhouetteRefine !== false,
      geometrySilhouetteStrength: [0.5,0.8,1,1.25].includes(Number(saved.geometrySilhouetteStrength)) ? Number(saved.geometrySilhouetteStrength) : 1,
      geometryLodPlanning: saved.geometryLodPlanning !== false,
      geometryMicroDisplacement: saved.geometryMicroDisplacement !== false,
      geometryHeightSource: ["auto","sidecar","diffuse"].includes(saved.geometryHeightSource) ? saved.geometryHeightSource : "auto",
      geometryDisplacementStrength: [0.5,0.8,1,1.25].includes(Number(saved.geometryDisplacementStrength)) ? Number(saved.geometryDisplacementStrength) : 0.8,
      geometryCreaseAngle: [0,45,55,65,75].includes(Number(saved.geometryCreaseAngle)) ? Number(saved.geometryCreaseAngle) : 0,
      geometryTriangleBudget: [0,60000,120000,250000].includes(Number(saved.geometryTriangleBudget)) ? Number(saved.geometryTriangleBudget) : 0,
    };
  }
  if (state.persistentCache) {
    await trimCache(state.cacheBudgetMb * 1024 * 1024);
    cacheState = await cacheInfo();
  }
  aiRunState = await controller.storeGet(currentRunKey()).catch(()=>null);
  if (aiRunState?.status === "running") {
    await storeAiRun(interruptAiRun(aiRunState)).catch(()=>undefined);
  }
  await scan();
  const previous=currentRunProgress();
  if (previous.compatible && previous.completed>0 && previous.status!=="complete") {
    setMessage(`Interrupted AI run found: ${previous.completed}/${previous.total} textures are checkpointed. Start AI graphics again to continue from cached results.`);
  } else if (previous.compatible && previous.status==="complete") {
    setMessage(`AI graphics already exist for this game/profile: ${previous.completed}/${previous.total} textures prepared. A new export will verify and reuse them.`);
  } else {
    setMessage("Ready. Fail-safe standard OpenRAC AI path is available.");
  }
}

start().catch((error) => setMessage(error instanceof Error ? error.message : String(error), true));
