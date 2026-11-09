// SPDX-License-Identifier: GPL-3.0-or-later
import {textureFiles} from "./texture-pack.js";

/**
 * Lists the ordinary OpenRAC texture-dump root. On launchers that expose Graphics preparation's
 * native source bootstrap, an empty dump is populated from already extracted level PNGs and listed
 * again. Existing runtime dumps remain authoritative and are never overwritten by the launcher.
 */
export async function listTextureSources(controller, info) {
  let files = await controller.list("dump");
  if (textureFiles(files).length > 0 || !info?.services?.includes("graphics-preparation")) {
    return {files, seeded:null, error:null};
  }

  try {
    const seeded = await controller.service("textures.sources.prepare", {});
    if (Number(seeded?.total) > 0 || Number(seeded?.added) > 0) {
      files = await controller.list("dump");
    }
    return {files, seeded:seeded ?? null, error:null};
  } catch (error) {
    return {
      files,
      seeded:null,
      error:error instanceof Error ? error.message : String(error),
    };
  }
}
