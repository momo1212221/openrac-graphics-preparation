// SPDX-License-Identifier: GPL-3.0-or-later
import {request} from "./bridge.js";
import {ModController} from "../src/controller.js";
import {resetAiSession, warmAi, upscaleAiPng} from "../src/ai-runtime.js";
import {prepareTextureFailSafe, readFailSafe} from "../src/resilience.js";
import {textureFiles, texturePackManifest, outputName, packPath} from "../src/texture-pack.js";
import {upscalePng} from "../src/upscale.js";
import {ZipStream} from "../src/zip.js";
import {EffectsEditor} from "./effects.js";

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
let state = {
  scale: 4,
  edgePreserving: true,
  includeInterface: true,
  aiMode: "balanced",
  preserveMicrodetail: true,
  preserveStars: true,
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

function updateTextures() { textures = textureFiles(allDumpFiles, {includeInterface: state.includeInterface}); }
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
  };

  try {
    if (ai) {
      progress(0, 1, "AI preflight · model + 128×128 inference check…");
      aiReady = await warmAi();
    }

    const suffix = ai ? `ai-${state.aiMode}-4x` : `${state.scale}x`;
    const token = await controller.saveStart(outputName(info, suffix), "zip");
    if (!token) { setMessage("Save cancelled."); return; }
    zip = new ZipStream(controller, token);

    let included = 0;
    for (let i = 0; i < textures.length; i++) {
      const texture = textures[i];
      const baseLabel = `${i + 1}/${textures.length} · ${texture.hash}`;
      let source;

      try {
        const read = await readFailSafe(() => controller.read("dump", texture.path), 2);
        source = read.bytes;
        if (read.attempts > 1) stats.retried++;
      } catch (error) {
        stats.unreadable++;
        stats.warnings.push({hash: texture.hash, strategy: "skipped", error: error instanceof Error ? error.message : String(error)});
        progress(i + 1, textures.length, `Skipped unreadable texture · ${baseLabel}`);
        continue;
      }

      if (ai) {
        const prepared = await prepareTextureFailSafe(source, {
          ai: () => upscaleAiPng(source, {
            mode: state.aiMode,
            preserveMicrodetail: state.preserveMicrodetail,
            preserveStars: state.preserveStars,
          }, (tile, totalTiles) => {
            const fraction = (i + tile / totalTiles) / textures.length;
            progress(fraction, 1, `AI · ${baseLabel} · tile ${tile}/${totalTiles}`);
          }),
          resetAi: resetAiSession,
          fallback: () => upscalePng(source, 4, true),
          retries: 1,
        });

        if (prepared.attempts > 1) stats.retried++;
        stats[prepared.strategy]++;
        stats.stars += prepared.stars;
        stats.microdetails += prepared.microdetails;
        if (prepared.strategy !== "ai") {
          stats.warnings.push({
            hash: texture.hash,
            strategy: prepared.strategy,
            errors: prepared.errors.slice(-3),
          });
        }
        await zip.add(packPath(texture), prepared.bytes);
      } else {
        let prepared;
        try {
          prepared = await upscalePng(source, state.scale, state.edgePreserving);
        } catch (error) {
          prepared = source;
          stats.original++;
          stats.warnings.push({hash: texture.hash, strategy: "original", error: error instanceof Error ? error.message : String(error)});
        }
        progress(i + 1, textures.length, `Local fallback · ${baseLabel}`);
        await zip.add(packPath(texture), prepared);
      }
      included++;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const manifest = texturePackManifest(info, included, ai
      ? {ai: true, mode: state.aiMode}
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
    };
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
        `${stats.ai}/${textures.length} textures used Real-ESRGAN`,
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
    ? `${aiReady.model} · ${aiReady.backend}`
    : "Bundled Real-ESRGAN x4plus + ONNX Runtime Web/WASM; loaded when preparation starts.");
  backend.control.append(el("span", "Standard launcher", "status-ok"));
  assets.append(backend.row);
  assets.append(el("p",
    "Only output/save failures stop the complete run. Individual decode, inference or scaling problems are isolated to that texture.",
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
  body.append(el("p",
    "Real-ESRGAN always receives fixed 128×128 inputs. A 112×112 core is used with 8 pixels of edge-clamped context. Large textures are processed tile-by-tile and the UI yields between tiles/textures.",
    "muted advanced-note"));
  advanced.append(body); content.append(advanced);

  if (effectsEditor) {
    for (const section of effectsEditor.render()) content.append(section);
  }
}

async function start() {
  info = await controller.info();
  effectsEditor = new EffectsEditor(controller, info, setMessage);
  await effectsEditor.start();
  document.addEventListener("graphics-effects-change", () => render());
  subtitle.textContent = `${info.game} / ${info.version} · Mod 0.6.0 · fail-safe standard launcher AI`;
  const saved = await controller.storeGet("texture-preparation").catch(() => null);
  if (saved && typeof saved === "object") {
    state = {
      scale: saved.scale === 2 ? 2 : 4,
      edgePreserving: saved.edgePreserving !== false,
      includeInterface: saved.includeInterface !== false,
      aiMode: ["faithful", "balanced", "enhanced"].includes(saved.aiMode) ? saved.aiMode : "balanced",
      preserveMicrodetail: saved.preserveMicrodetail !== false,
      preserveStars: saved.preserveStars !== false,
    };
  }
  await scan();
  setMessage("Ready. Fail-safe standard OpenRAC AI path is available.");
}

start().catch((error) => setMessage(error instanceof Error ? error.message : String(error), true));
