# Graphics preparation

Integrated texture preparation for the official OpenRAC launcher.

Version 0.3.0 removes the Python-helper requirement for the normal texture-upscale flow. The mod
page now reads OpenRAC's own saved texture assets through the documented mod-tool API, upscales them
locally, and writes a standard OpenRAC texture-pack ZIP.

## What it does

- uses the same compact settings-page structure as OpenRAC's Enhanced graphics page;
- reads the textures OpenRAC saved while you played;
- prepares them at 2x or 4x;
- can preserve hard edges for HUD, fonts and stylised textures;
- streams the result into a normal OpenRAC texture-pack ZIP;
- does not run Python, shell commands or a localhost service.

Lighting, shadows, ambient occlusion and temporal upscaling remain in OpenRAC's built-in
**Enhanced graphics** page. This mod does not duplicate them.

## Use

1. In OpenRAC open **Mods -> Models and textures**.
2. Turn on **Save the game's textures while you play**.
3. Play the planets and menus whose textures you want to prepare.
4. Open **Mods -> Graphics preparation -> Open**.
5. Choose **2x** or **4x Ultra**, and whether edge preservation and interface textures are enabled.
6. Press **Prepare textures** and choose where to save the ZIP.
7. Add that ZIP through **Mods -> Add a mod**. OpenRAC recognises it as a standard texture pack.

The pack keeps the texture hashes OpenRAC uses, so the prepared pictures replace the matching
textures without needing the level editor or a separate conversion UI.

## Compatibility

The mod keeps the no-op Luau compatibility entry point used by older Launcher 1.0.2. The integrated
asset page itself needs a launcher build with mod-tool pages and the protocol-1 list/read/save
operations, including Development 1.0.3-dev.842 and newer builds based on that API.

## Processing

The integrated path is a local image upscale, not a neural-network model download. Edge preservation
uses crisp pixel expansion; with it off the browser uses its high-quality image resampler. The
texture identity, alpha channel and OpenRAC pack structure are preserved.

The older external helper remains in the repository for experiments, but it is no longer part of the
release artifact or required for this workflow.

## Develop

```sh
node --test
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/package.py
```

GPL-3.0-or-later. No game, disc, save data or model weights are included.
