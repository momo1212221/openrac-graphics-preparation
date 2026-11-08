# Graphics preparation

A companion tool for the official OpenRAC launcher.

Version 0.2.1 keeps the documented OpenRAC mod-tool page API and adds a harmless script fallback
so the package can also be installed by OpenRAC Launcher 1.0.2, which otherwise mistakes a page-only
mod for an unbuilt native mod.

## Compatibility with OpenRAC

- **Launcher 1.0.2:** the package installs through the no-op `main.luau` compatibility entry point.
  Launcher 1.0.2 does not expose a mod's own `tool.page`, so use the external helper for Ultra/AI
  texture jobs on that launcher.
- **Launcher builds with mod-tool pages:** the **Graphics preparation** page opens inside the Mods tab
  and can export helper jobs through the documented sandboxed API.

The compatibility script does not change gameplay.

OpenRAC already provides the native preparation path for enhanced lighting/GI, probe baking,
interior lighting, water preparation and reflections. For those features use:

**Mods -> Enhanced graphics -> Prepare the enhanced lighting**

No external helper is required for that built-in OpenRAC path.

## External helper required for Ultra / AI textures

Ultra textures and AI-texture preparation are different. On launchers with mod-tool pages, export
the requested JSON job from **Graphics preparation**. On Launcher 1.0.2, prepare the job externally.
Then run `openrac-graphics-helper.py`; it creates a normal OpenRAC overrides-pack ZIP.

The helper is not needed for the normal Enhanced graphics lighting bake.

## Install

1. Download the release artifact **`graphics-preparation-0.2.1.zip`**.
2. Do **not** use GitHub's `openrac-graphics-preparation-main.zip` source archive.
3. In OpenRAC choose **Mods -> Add mod -> ZIP**.
4. Select `graphics-preparation-0.2.1.zip`.
5. On newer launchers, open **Graphics preparation** from the mod page. On Launcher 1.0.2, use the
   released `openrac-graphics-helper.py` externally for Ultra/AI jobs.

No fork launcher and no `launcher-service` bridge are required.

## Running the external texture helper

Example:

```sh
python3 openrac-graphics-helper.py openrac-rac1-pal-ultra-textures.json \
  --openrac-root /path/to/OpenRAC \
  --out ./prepared
```

The helper looks for `realesrgan-ncnn-vulkan` in `PATH`. Override it with `--upscaler` or set
`OPENRAC_TEXTURE_UPSCALER`. The helper uses OpenRAC's own `editor/assets.py` exporter/importer,
processes PNG textures, imports the changes and creates a standard overrides-pack ZIP.

Use `--levels /path/to/levels` when exported levels live outside the checkout and `--dry-run` to
validate a job without starting the upscaler.

## AI meshes

The portable job format reserves an AI-mesh operation, but no mesh backend is integrated yet.

## Security model

The mod-tool page stays sandboxed. It cannot execute terminal commands, start arbitrary local
programs or connect to a privileged localhost service. The compatibility Luau script is a no-op.

## Develop

```sh
node --test
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/package.py
```

GPL-3.0-or-later. No game, disc, save data or model weights are included.
