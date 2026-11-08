// SPDX-License-Identifier: GPL-3.0-or-later
import {request} from "./bridge.js";
import {ModController} from "../src/controller.js";
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
let state = {scale: 2, edgePreserving: true, includeInterface: true};

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
  document.querySelectorAll("button,input").forEach((node) => { node.disabled = value; });
}

async function savePrefs() {
  await controller.storeSet("texture-preparation", state);
}

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
}

async function scan() {
  allDumpFiles = await controller.list("dump");
  updateTextures();
  render();
}

function progress(done, total, label) {
  const text = document.querySelector("#progress-text");
  const bar = document.querySelector("#progress-bar");
  if (text) text.textContent = label;
  if (bar) bar.style.width = total ? `${Math.round(done / total * 100)}%` : "0%";
}

async function prepare() {
  if (busy) return;
  if (!textures.length) {
    setMessage("No saved OpenRAC textures found. Enable texture dumping in Mods → Models and textures, play the game, then come back here.", true);
    return;
  }
  setBusy(true);
  setMessage("Preparing OpenRAC textures…");
  let zip = null;
  try {
    const token = await controller.saveStart(outputName(info, state.scale), "zip");
    if (!token) {
      setMessage("Save cancelled.");
      return;
    }
    zip = new ZipStream(controller, token);
    const manifest = texturePackManifest(info, textures.length, state.scale, state.edgePreserving);
    await zip.add("openrac-texture-pack.json", encoder.encode(JSON.stringify(manifest, null, 2) + "\n"));

    for (let i = 0; i < textures.length; i++) {
      const texture = textures[i];
      progress(i, textures.length, `Preparing ${i + 1} of ${textures.length} · ${texture.hash}`);
      const source = await controller.read("dump", texture.path);
      const prepared = await upscalePng(source, state.scale, state.edgePreserving);
      await zip.add(packPath(texture), prepared);
    }

    progress(textures.length, textures.length, `Prepared ${textures.length} of ${textures.length}`);
    const saved = await zip.finish();
    zip = null;
    setMessage(saved
      ? `Saved ${saved}. Add that ZIP through Mods → Add a mod; OpenRAC will use it as a texture pack.`
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
  left.append(el("div", "TEXTURES", "eyebrow"));
  const ready = textures.length
    ? `Ready for ${textures.length} saved texture${textures.length === 1 ? "" : "s"}.`
    : "No saved textures are ready yet.";
  left.append(el("p", ready, "lead"), el("p",
    "Uses OpenRAC's own saved texture assets. No Python helper or separate processing window is required.",
    "muted"));
  const prepareButton = el("button", "Prepare textures", "primary");
  prepareButton.onclick = () => void prepare();
  prepareCard.append(left, prepareButton);
  const progressWrap = el("div", undefined, "progress span");
  progressWrap.append(el("div", "Ready.", "progress-label"));
  progressWrap.firstChild.id = "progress-text";
  const track = el("div", undefined, "progress-track");
  const bar = el("div", undefined, "progress-bar");
  bar.id = "progress-bar";
  track.append(bar);
  progressWrap.append(track);
  prepareCard.append(progressWrap);
  content.append(prepareCard);

  const general = el("section", undefined, "panel");
  general.append(el("div", "GENERAL", "eyebrow"));

  const scale = settingRow("Texture upscaling", "Enlarges OpenRAC textures locally and keeps the original texture identifiers.");
  scale.control.append(segmented([[2, "2x"], [4, "4x Ultra"]], state.scale, async (value) => {
    state.scale = value;
    await savePrefs();
    render();
  }));
  general.append(scale.row);

  const edge = settingRow("Edge preservation", "Keeps hard UI and texture edges crisp instead of smoothing them.");
  edge.control.append(toggle(state.edgePreserving, "Edge preservation", async (value) => {
    state.edgePreserving = value;
    await savePrefs();
    render();
  }));
  general.append(edge.row);

  const ui = settingRow("Interface textures", "Also prepares HUD, menus, fonts and other 2D textures saved by OpenRAC.");
  ui.control.append(toggle(state.includeInterface, "Interface textures", async (value) => {
    state.includeInterface = value;
    updateTextures();
    await savePrefs();
    render();
  }));
  general.append(ui.row);
  content.append(general);

  const assets = el("section", undefined, "panel");
  assets.append(el("div", "OPENRAC ASSETS", "eyebrow"));
  const source = settingRow("Saved textures", textures.length
    ? `${textures.length} unique texture${textures.length === 1 ? "" : "s"} detected for ${info.packId}.`
    : "Use Mods → Models and textures → Save the game's textures while you play, then return here.");
  const refresh = el("button", "Refresh", "ghost");
  refresh.onclick = () => void scan().catch((error) => setMessage(String(error), true));
  source.control.append(refresh);
  assets.append(source.row);
  const note = el("p",
    "Lighting, shadows, ambient occlusion and temporal upscaling stay in OpenRAC's built-in Enhanced graphics page. This mod only prepares replacement texture assets.",
    "info-note");
  assets.append(note);
  content.append(assets);

  const advanced = document.createElement("details");
  advanced.className = "panel advanced";
  const summary = el("summary");
  summary.append(el("span", "ADVANCED"), el("span", "⌄", "chevron"));
  advanced.append(summary);
  const body = el("div", undefined, "advanced-body");
  body.append(el("p",
    "The generated ZIP is a standard OpenRAC texture pack with openrac-texture-pack.json. Processing happens sequentially and the ZIP is streamed to disk, so the whole game does not need to fit in memory at once.",
    "muted"));
  advanced.append(body);
  content.append(advanced);
}

async function start() {
  info = await controller.info();
  subtitle.textContent = `${info.game} / ${info.version} · Mod 0.3.0 · OpenRAC asset pipeline`;
  const saved = await controller.storeGet("texture-preparation").catch(() => null);
  if (saved && typeof saved === "object") {
    state = {
      scale: saved.scale === 4 ? 4 : 2,
      edgePreserving: saved.edgePreserving !== false,
      includeInterface: saved.includeInterface !== false,
    };
  }
  await scan();
  setMessage("Ready.");
}

start().catch((error) => setMessage(error instanceof Error ? error.message : String(error), true));
