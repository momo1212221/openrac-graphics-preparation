# Graphics preparation

A companion tool for the **current official OpenRAC launcher**.

Version 0.2 removes the private `launcher-service` dependency and uses only OpenRAC's documented
protocol-1 mod-tool page API.

## Compatibility with current OpenRAC

The mod itself now works with the current official OpenRAC launcher.

OpenRAC already provides the native preparation path for:

- enhanced lighting / GI
- probe baking
- interior lighting
- water preparation
- reflections

For those features, use:

**Mods -> Enhanced graphics -> Prepare the enhanced lighting**

No external helper is required for that built-in OpenRAC path.

## External helper required for Ultra / AI textures

Ultra textures and AI-texture preparation are different.

The official OpenRAC mod page runs in a sandbox and intentionally cannot start arbitrary local
programs. Therefore the mod cannot launch the texture upscaler itself.

For **Ultra textures** and **AI textures**, you must currently:

1. Open **Graphics preparation** in OpenRAC.
2. Export the requested JSON job.
3. Start `openrac-graphics-helper.py` externally.
4. Let the helper create the prepared OpenRAC overrides-pack ZIP.
5. Install that ZIP through **Mods -> Add mod -> ZIP**.

The helper is not needed for the normal Enhanced graphics lighting bake.

## Install

1. Build with `python3 tools/package.py` or download the release artifacts.
2. In official OpenRAC choose **Mods -> Add mod -> ZIP**.
3. Select `graphics-preparation-0.2.0.zip`.
4. Open **Graphics preparation** from the mod page.

No fork launcher and no `launcher-service` bridge are required.

## Running the external texture helper

Example:

```sh
python3 openrac-graphics-helper.py openrac-rac1-pal-ultra-textures.json \
  --openrac-root /path/to/OpenRAC \
  --out ./prepared
```

The helper looks for `realesrgan-ncnn-vulkan` in `PATH`.

You can override the executable with:

```sh
python3 openrac-graphics-helper.py job.json \
  --openrac-root /path/to/OpenRAC \
  --upscaler /path/to/realesrgan-ncnn-vulkan
```

or set:

```sh
OPENRAC_TEXTURE_UPSCALER=/path/to/realesrgan-ncnn-vulkan
```

The helper uses OpenRAC's own `editor/assets.py` exporter/importer. It exports the available
`level_XX` assets, processes their PNG textures, imports the changes again and creates a normal
OpenRAC overrides-pack ZIP.

If the exported OpenRAC levels are stored outside the checkout, pass:

```sh
--levels /path/to/levels
```

Use `--dry-run` to validate the job and print the intended processing steps without starting
OpenRAC tools or the texture upscaler.

## AI meshes

The portable job format already reserves an **AI meshes** operation, but it is not functional yet.

Current official OpenRAC does not ship a mesh upscaler, so a separate mesh backend must be selected
and integrated before this operation can run.

## Security model

The OpenRAC mod page remains sandboxed.

It uses only the official mod-tool calls needed for the UI, such as `info`, `save`, `open` and
optional mod-store access.

The page cannot:

- execute terminal commands
- start the external helper by itself
- choose arbitrary filesystem paths
- start arbitrary local programs
- connect to a privileged localhost service

The external helper runs only when the user starts it separately.

## Develop

```sh
node --test
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/package.py
```

The package build is deterministic and produces the installable mod ZIP plus the helper script, with
hashes in `dist/SHA256SUMS`.

GPL-3.0-or-later. No game, disc, save data or model weights are included.
