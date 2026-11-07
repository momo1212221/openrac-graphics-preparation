// SPDX-License-Identifier: GPL-3.0-or-later
import {request, encodeJson, decodeJson} from "./bridge.js";
import {ModController} from "../src/controller.js";

const controller = new ModController(request);
const content = document.querySelector("#content");
const message = document.querySelector("#message");
const subtitle = document.querySelector("#subtitle");
let info;
let busy = false;

const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

function section(title, text) {
  const node = el("section");
  node.append(el("h2", title), el("p", text));
  content.append(node);
  return node;
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll("button").forEach((button) => { button.disabled = value; });
}

async function run(work) {
  if (busy) return;
  setBusy(true);
  message.classList.remove("error");
  message.textContent = "Working…";
  try {
    const text = await work();
    message.textContent = text || "Done.";
  } catch (error) {
    message.classList.add("error");
    message.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setBusy(false);
  }
}

function action(parent, text, work, note) {
  const row = el("div");
  row.className = "action";
  const button = el("button", text);
  button.addEventListener("click", () => run(work));
  row.append(button);
  if (note) row.append(el("small", note));
  parent.append(row);
}

async function exportJob(operation, options, name) {
  const job = controller.helperJob(operation, info, options);
  const saved = await controller.save(name, "json", encodeJson(job));
  return saved ? `Helper job saved as ${saved}. Run it with openrac-graphics-helper.py.` : "Save cancelled.";
}

async function importResult() {
  const bytes = await controller.open("json");
  if (!bytes) return "Open cancelled.";
  const result = controller.parseResult(decodeJson(bytes));
  const where = result.output ? ` Output: ${result.output}` : "";
  if (!result.ok) throw new Error((result.message || "Helper failed.") + where);
  return (result.message || "Helper finished successfully.") + where;
}

function render() {
  content.replaceChildren();
  const lighting = section(
    "Enhanced lighting, water & reflections",
    "Current official OpenRAC already owns this preparation path. In Mods → Enhanced graphics, enable it and use Prepare the enhanced lighting. This companion does not duplicate or bypass the official baker."
  );
  const note = el("p", "The official mod-tool sandbox intentionally cannot start launcher jobs. That keeps an installed mod from executing arbitrary programs.");
  note.className = "hint";
  lighting.append(note);

  const textures = section(
    "Offline textures",
    "For heavier offline processing, export a small JSON job and run the separate helper. The helper uses OpenRAC's own asset exporter/importer and creates a normal overrides-pack ZIP that standard OpenRAC can install."
  );
  action(textures, "Export Ultra texture job", () => exportJob(
    "textures.prepare",
    {scale: 4, model: "realesrgan-x4plus"},
    `openrac-${info.game}-${info.version}-ultra-textures`
  ), "Requires a compatible texture upscaler on the helper side.");
  action(textures, "Export AI texture job (balanced)", () => exportJob(
    "ai.textures",
    {mode: "balanced", scale: 2, model: "realesrgan-x4plus"},
    `openrac-${info.game}-${info.version}-ai-textures`
  ));

  const meshes = section(
    "AI meshes",
    "The portable job format already reserves mesh preparation, but the helper needs an explicit mesh backend because official OpenRAC does not ship one."
  );
  action(meshes, "Export AI mesh job", () => exportJob(
    "ai.meshes",
    {mode: "balanced"},
    `openrac-${info.game}-${info.version}-ai-meshes`
  ), "The current helper reports this as unsupported until a mesh backend is configured.");

  const results = section("Helper result", "Import the result JSON written by the helper to see its final status and output path here.");
  action(results, "Open helper result…", importResult);

  const compatibility = section("Compatibility", "This page uses only the official OpenRAC protocol-1 mod-tool calls: info, save, open and the mod store. It has no launcher-service bridge dependency.");
  const list = el("ul");
  for (const [label, value] of [["Game", info.game], ["Disc", info.version], ["System", info.system], ["Launcher API", "mod-tool protocol 1"]]) {
    const item = el("li");
    item.append(el("strong", label + ": "), document.createTextNode(String(value ?? "unknown")));
    list.append(item);
  }
  compatibility.append(list);
}

try {
  info = await controller.info();
  subtitle.textContent = `${info.game} / ${info.version} · Mod 0.2.0 · official OpenRAC compatible`;
  render();
  message.textContent = "Ready.";
} catch (error) {
  message.classList.add("error");
  message.textContent = error instanceof Error ? error.message : String(error);
}
