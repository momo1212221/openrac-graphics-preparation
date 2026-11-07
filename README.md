# Graphics preparation

A companion tool for the **current official OpenRAC launcher**. Version 0.2 removes the private
`launcher-service` dependency and uses only OpenRAC's documented protocol-1 mod-tool page API.

## What changed

Official OpenRAC already owns enhanced lighting, water preparation, reflections and the probe baker.
This mod no longer tries to start a second privileged baker from inside its sandbox. Use
**Mods → Enhanced graphics → Prepare the enhanced lighting** for that path.

The mod page remains useful for heavier offline asset work. It exports a small JSON job through the
launcher's normal Save dialog. The separately runnable `openrac-graphics-helper.py` consumes that job,
uses OpenRAC's own `editor/assets.py` exporter/importer, and writes an ordinary overrides-pack ZIP.
That ZIP can be installed through the standard **Mods → Add mod → ZIP** flow.

## Install

1. Build with `python3 tools/package.py` or download the release artifacts.
2. In official OpenRAC choose **Mods → Add mod → ZIP** and select
   `graphics-preparation-0.2.0.zip`.
3. Open **Graphics preparation** from the mod page.

No fork launcher and no launcher-service bridge are required.

## Texture helper

Export an Ultra or AI-texture job from the mod page, then run for example:

```sh
python3 openrac-graphics-helper.py openrac-rac1-pal-ultra-textures.json \
  --openrac-root /path/to/OpenRAC \
  --out ./prepared
```

The helper looks for `realesrgan-ncnn-vulkan` in `PATH`. Override it with `--upscaler /path/to/tool`
or `OPENRAC_TEXTURE_UPSCALER`. It exports every ready `level_XX`, processes the PNGs, imports the
changes with OpenRAC's own asset importer and creates a standard pack ZIP.

For an installed OpenRAC whose exported levels are elsewhere, pass `--levels /path/to/levels`.
`--dry-run` validates a job and prints the plan without running OpenRAC or the upscaler.

AI mesh jobs are part of the portable format but currently fail clearly until a mesh backend is
configured; official OpenRAC does not ship a mesh upscaler.

## Security model

The launcher page remains sandboxed. It uses only `info`, `save`, `open` and optional mod-store calls.
It cannot run terminal commands, choose arbitrary filesystem paths or connect to a localhost daemon.
Privileged processing happens only when the user separately starts the helper.

## Develop

```sh
node --test
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/package.py
```

The package build is deterministic and produces both the installable mod ZIP and the helper script,
with hashes in `dist/SHA256SUMS`.

GPL-3.0-or-later. No game, disc, save data or model weights are included.
