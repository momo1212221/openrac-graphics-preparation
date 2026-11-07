// SPDX-License-Identifier: GPL-3.0-or-later
/** Pure controller for the official OpenRAC Mod Tool protocol. No privileged launcher service is required. */
export const JOB_KIND = "openrac-graphics-preparation-job";
export const RESULT_KIND = "openrac-graphics-preparation-result";
export const JOB_OPERATIONS = ["textures.prepare", "ai.textures", "ai.meshes"];

export class ModController {
  constructor(request) {
    if (typeof request !== "function") throw new TypeError("request must be a function");
    this.request = request;
  }

  info() { return this.request("info"); }
  storeGet(key) { return this.request("storeGet", {key}); }
  storeSet(key, value) { return this.request("storeSet", {key, value}); }
  save(name, extension, bytes) { return this.request("save", {name, extension, bytes}); }
  open(extension = "json") { return this.request("open", {extension}); }

  helperJob(operation, info, options = {}) {
    if (!JOB_OPERATIONS.includes(operation)) throw new Error("Unsupported helper operation: " + operation);
    if (!info || typeof info.game !== "string" || typeof info.version !== "string") {
      throw new TypeError("launcher info must contain game and version");
    }
    return {
      format: 1,
      kind: JOB_KIND,
      operation,
      game: info.game,
      version: info.version,
      createdBy: {mod: "graphics-preparation", version: "0.2.0"},
      options: JSON.parse(JSON.stringify(options ?? {})),
    };
  }

  parseResult(value) {
    if (!value || value.format !== 1 || value.kind !== RESULT_KIND || typeof value.operation !== "string") {
      throw new Error("Not a Graphics preparation helper result");
    }
    if (typeof value.ok !== "boolean") throw new Error("Helper result has no success state");
    return value;
  }
}
