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
let nativeAi = false;
let nativeStatus = null;
let state = {
  scale: 4,
  edgePreserving: true,
  includeInterface: true,
  aiMode: "balanced",
  preserveMicrodetail: true,
  preserveStars: true,
  aiMeshes: true,
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

async function refreshNativeStatus() {
  if (!nativeAi) return null;
  try {
    nativeStatus = await controller.service("status", {});
    return nativeStatus;
  } catch (error) {
    nativeStatus = null;
    setMessage(error instanceof Error ? error.message : String(error), true);
    return null;
  }
}

async function prepareAi() {
  if (busy || !nativeAi) return;
  if (!textures.length) {
    setMessage("No dumped textures yet. In Models and textures, enable saving the game's textures and play once before AI preparation.", true);
    return;
  }

  setBusy(true);
  progress(0, 1, "Starting native AI asset preparation…");
  setMessage("AI asset pre-render is running. Textures are processed offline; the game does not pay an AI runtime cost.");

  try {
    const status = await refreshNativeStatus();
    if (status && status.enabled === false) {
      setMessage("Graphics preparation is switched off. Go back one page, switch the mod On, then run AI preparation.", true);
      return;
    }

    progress(0, 2, "AI textures · Upscayl/NCNN");
    const result = await controller.service("ai.textures", {
      mode: state.aiMode,
      preserveMicrodetail: state.preserveMicrodetail,
      preserveStars: state.preserveStars,
    });

    let meshText = "";
    if (state.aiMeshes) {
      progress(1, 2, "AI render meshes · collision stays original");
      try {
        const meshes = await controller.service("ai.meshes", {mode: state.aiMode});
        meshText = meshes?.available
          ? ` ${meshes.processed}/${meshes.discovered} render meshes were refined; collision stayed original.`
          : ` ${meshes?.discovered ?? 0} render meshes were found, but no compatible 3D AI worker is installed, so geometry stayed original.`;
      } catch (meshError) {
        meshText = ` Texture AI succeeded; mesh AI was skipped: ${meshError instanceof Error ? meshError.message : String(meshError)}`;
      }
    }

    progress(2, 2, "AI asset pack ready");
    setMessage(
      `${result.processed} textures rendered with ${result.model}. Preserved ${result.preservedStars} stars/tiny lights and ${result.preservedMicrodetails} microdetails.${meshText}`
    );
    await scan();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), true);
  } finally {
    setBusy(false);
  }
}

async function prepareLocal() {
  if (busy) return;
  if (!textures.length) {
    setMessage("No saved OpenRAC textures found. Enable texture dumping in Mods → Models and textures, play the game, then come back here.", true);
    return;
  }
  setBusy(true);
  setMessage("Preparing local OpenRAC texture pack…");
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
      progress(i, textures.length, `Local fallback · ${i + 1} of ${textures.length} · ${texture.hash}`);
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
  left.append(el("div", nativeAi ? "AI GRAPHICS" : "TEXTURES", "eyebrow"));
  const ready = textures.length
    ? `Ready for ${textures.length} saved texture${textures.length === 1 ? "" : "s"}.`
    : "No saved textures are ready yet.";
  left.append(
    el("p", ready, "lead"),
    el("p",
      nativeAi
        ? "Uses the native AI preparation path from your OpenRAC fork: Upscayl/NCNN textures plus optional render-mesh AI."
        : "This launcher has no graphics-preparation service. Local 2x/4x preparation remains available as the compatibility fallback.",
      "muted"),
  );
  const prepareButton = el("button", nativeAi ? "Prepare AI graphics" : "Prepare textures", "primary");
  prepareButton.onclick = () => void (nativeAi ? prepareAi() : prepareLocal());
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
  general.append(el("div", "AI ASSET ENHANCEMENT", "eyebrow"));

  const profile = settingRow(
    "AI asset profile",
    "Faithful preserves the original look. Balanced adds material detail. Maximum Detail allows the strongest reconstruction.",
  );
  profile.control.append(select([
    ["faithful", "Faithful · original look"],
    ["balanced", "Balanced · recommended"],
    ["enhanced", "Maximum detail"],
  ], state.aiMode, async (value) => {
    state.aiMode = value;
    await savePrefs();
  }));
  general.append(profile.row);

  const micro = settingRow(
    "Preserve original micro-detail",
    "Re-injects tiny source detail after the neural pass so texture grain and small highlights are not erased.",
  );
  micro.control.append(toggle(state.preserveMicrodetail, "Preserve original micro-detail", async (value) => {
    state.preserveMicrodetail = value;
    await savePrefs();
    render();
  }));
  general.append(micro.row);

  const stars = settingRow(
    "Preserve stars & tiny lights",
    "Protects one-pixel stars, windows and small emissive dots that AI upscalers can mistake for noise.",
  );
  stars.control.append(toggle(state.preserveStars, "Preserve stars and tiny lights", async (value) => {
    state.preserveStars = value;
    await savePrefs();
    render();
  }));
  general.append(stars.row);

  const meshes = settingRow(
    "AI render meshes",
    "Also runs the fork's optional 3D AI worker for render meshes. Gameplay collision is never modified.",
  );
  meshes.control.append(toggle(state.aiMeshes, "AI render meshes", async (value) => {
    state.aiMeshes = value;
    await savePrefs();
    render();
  }));
  general.append(meshes.row);
  content.append(general);

  const assets = el("section", undefined, "panel");
  assets.append(el("div", "OPENRAC ASSETS", "eyebrow"));
  const source = settingRow(
    "Saved textures",
    textures.length
      ? `${textures.length} unique texture${textures.length === 1 ? "" : "s"} detected for ${info.packId}.`
      : "Use Mods → Models and textures → Save the game's textures while you play, then return here.",
  );
  const refresh = el("button", "Refresh", "ghost");
  refresh.onclick = () => void scan().catch((error) => setMessage(String(error), true));
  source.control.append(refresh);
  assets.append(source.row);

  const backend = settingRow(
    "AI backend",
    nativeAi
      ? `Native graphics-preparation service is available in this fork launcher${info.hostVersion ? ` (host ${info.hostVersion})` : ""}.`
      : "Native AI service is not exposed by this launcher. Install/use your OpenRAC fork build for the neural path.",
  );
  backend.control.append(el("span", nativeAi ? "Native" : "Fallback", nativeAi ? "status-ok" : "status-warn"));
  assets.append(backend.row);

  assets.append(el("p",
    "Lighting, GI, water, clouds, ray-traced sunlight and renderer effects stay in the fork's Enhanced graphics / Graphics preparation pipeline. AI assets are prepared offline and reused in game.",
    "info-note"));
  content.append(assets);

  const advanced = document.createElement("details");
  advanced.className = "panel advanced";
  const summary = el("summary");
  summary.append(el("span", "ADVANCED"), el("span", "⌄", "chevron"));
  advanced.append(summary);
  const body = el("div", undefined, "advanced-body");

  const scale = settingRow("Local fallback scale", "Used only when the native AI service is unavailable, or when you deliberately use local fallback export.");
  scale.control.append(segmented([[2, "2x"], [4, "4x Ultra"]], state.scale, async (value) => {
    state.scale = value;
    await savePrefs();
    render();
  }));
  body.append(scale.row);

  const edge = settingRow("Local edge preservation", "Keeps hard HUD/font edges crisp in the non-AI fallback.");
  edge.control.append(toggle(state.edgePreserving, "Local edge preservation", async (value) => {
    state.edgePreserving = value;
    await savePrefs();
    render();
  }));
  body.append(edge.row);

  const ui = settingRow("Interface textures", "Also includes HUD, menus, fonts and other 2D textures in the local fallback pack.");
  ui.control.append(toggle(state.includeInterface, "Interface textures", async (value) => {
    state.includeInterface = value;
    updateTextures();
    await savePrefs();
    render();
  }));
  body.append(ui.row);

  if (nativeAi) {
    const fallbackButton = el("button", "Export local fallback pack", "ghost advanced-action");
    fallbackButton.onclick = () => void prepareLocal();
    body.append(fallbackButton);
  }

  body.append(el("p",
    "Fork AI backend: macOS expects Upscayl in /Applications/Upscayl.app; Windows searches the launcher/resources, LocalAppData, Program Files and PATH; Linux uses upscayl-bin/models. The fork stages a complete pack and only swaps it in after successful processing.",
    "muted advanced-note"));
  advanced.append(body);
  content.append(advanced);
}

async function start() {
  info = await controller.info();
  nativeAi = Array.isArray(info.services) && info.services.includes("graphics-preparation");
  subtitle.textContent = `${info.game} / ${info.version} · Mod 0.4.0 · ${nativeAi ? "native fork AI" : "OpenRAC asset pipeline"}`;

  const saved = await controller.storeGet("texture-preparation").catch(() => null);
  if (saved && typeof saved === "object") {
    state = {
      scale: saved.scale === 2 ? 2 : 4,
      edgePreserving: saved.edgePreserving !== false,
      includeInterface: saved.includeInterface !== false,
      aiMode: ["faithful", "balanced", "enhanced"].includes(saved.aiMode) ? saved.aiMode : "balanced",
      preserveMicrodetail: saved.preserveMicrodetail !== false,
      preserveStars: saved.preserveStars !== false,
      aiMeshes: saved.aiMeshes !== false,
    };
  }

  await scan();
  if (nativeAi) await refreshNativeStatus();
  setMessage(nativeAi
    ? "Ready. Native AI graphics from your fork are available."
    : "Ready. This launcher exposes the local fallback only.");
}

start().catch((error) => setMessage(error instanceof Error ? error.message : String(error), true));
