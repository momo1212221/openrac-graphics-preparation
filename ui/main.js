// SPDX-License-Identifier: GPL-3.0-or-later
import {request} from "./bridge.js";
import {ModController} from "../src/controller.js";
import {warmAi, upscaleAiPng} from "../src/ai-runtime.js";
import {textureFiles, texturePackManifest, outputName, packPath} from "../src/texture-pack.js";
import {upscalePng} from "../src/upscale.js";
import {ZipStream} from "../src/zip.js";

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
  let stars = 0;
  let microdetails = 0;
  try {
    if (ai) {
      progress(0, 1, "Loading bundled Real-ESRGAN model…");
      aiReady = aiReady || await warmAi();
    }
    const suffix = ai ? `ai-${state.aiMode}-4x` : `${state.scale}x`;
    const token = await controller.saveStart(outputName(info, suffix), "zip");
    if (!token) { setMessage("Save cancelled."); return; }
    zip = new ZipStream(controller, token);
    const manifest = texturePackManifest(info, textures.length, ai
      ? {ai: true, mode: state.aiMode}
      : {scale: state.scale, edgePreserving: state.edgePreserving});
    await zip.add("openrac-texture-pack.json", encoder.encode(JSON.stringify(manifest, null, 2) + "\n"));

    for (let i = 0; i < textures.length; i++) {
      const texture = textures[i];
      const source = await controller.read("dump", texture.path);
      let prepared;
      if (ai) {
        prepared = await upscaleAiPng(source, {
          mode: state.aiMode,
          preserveMicrodetail: state.preserveMicrodetail,
          preserveStars: state.preserveStars,
        }, (tile, totalTiles) => {
          const texturePart = i / textures.length;
          const tilePart = (tile / totalTiles) / textures.length;
          progress(texturePart + tilePart, 1, `AI texture ${i + 1}/${textures.length} · tile ${tile}/${totalTiles}`);
        });
        stars += prepared.stars;
        microdetails += prepared.microdetails;
        await zip.add(packPath(texture), prepared.bytes);
      } else {
        progress(i, textures.length, `Local fallback · ${i + 1}/${textures.length}`);
        prepared = await upscalePng(source, state.scale, state.edgePreserving);
        await zip.add(packPath(texture), prepared);
      }
    }

    progress(1, 1, "Texture pack ready");
    const saved = await zip.finish();
    zip = null;
    setMessage(saved
      ? ai
        ? `Saved ${saved}. Real-ESRGAN processed ${textures.length} textures; restored ${stars} stars/tiny lights and ${microdetails} microdetails. Add the ZIP through Mods → Add a mod.`
        : `Saved ${saved}. Add the ZIP through Mods → Add a mod.`
      : "Save cancelled.");
  } catch (error) {
    if (zip) await zip.cancel().catch(() => undefined);
    setMessage(error instanceof Error ? error.message : String(error), true);
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
    el("p", "Real-ESRGAN runs inside the standard OpenRAC mod page using bundled ONNX Runtime Web/WASM. No Python, native helper or custom launcher is required.", "muted"),
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
    "The standard launcher intentionally cannot install a generated pack automatically. After preparation, add the saved ZIP through Mods → Add a mod. No custom launcher APIs are used.",
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
    "AI runs one 96×96 source tile at a time with overlap, so large textures do not require one huge inference allocation. The model and WASM runtime are shipped inside the mod and the page has no network access.",
    "muted advanced-note"));
  advanced.append(body); content.append(advanced);
}

async function start() {
  info = await controller.info();
  subtitle.textContent = `${info.game} / ${info.version} · Mod 0.5.0 · standard launcher AI`;
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
  setMessage("Ready. Standard OpenRAC launcher AI path is available.");
}

start().catch((error) => setMessage(error instanceof Error ? error.message : String(error), true));
