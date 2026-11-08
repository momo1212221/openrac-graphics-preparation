# Graphics preparation

Integrated OpenRAC graphics preparation.

Version 0.4.0 ports the native AI asset path from the user's OpenRAC fork into the installed
Graphics preparation mod. The same page now chooses the fork's neural pipeline when the launcher
exposes the bounded `graphics-preparation` service, and keeps the 2x/4x browser path as a compatibility
fallback on stock launchers.

## Native fork AI

With the matching fork launcher, **Prepare AI graphics** runs the same offline path already present
in `integration/upstream-develop-20261108`:

- Upscayl/NCNN 4x texture reconstruction;
- **Faithful**, **Balanced**, and **Maximum detail** profiles;
- post-processing that restores source micro-detail;
- preservation of stars, windows and tiny emissive lights that neural models can remove as noise;
- optional render-mesh AI via `openrac-mesh-ai`;
- collision assets are never sent to the 3D AI worker;
- staging and backup before a new AI texture pack replaces the previous prepared pack.

There is no AI work in the game render loop. Assets are prepared once and reused.

On macOS the current fork backend expects Upscayl at
`/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin` with its models folder. Windows
searches launcher resources, LocalAppData, Program Files and PATH. Linux uses `upscayl-bin`.

## UI

The page follows the same compact settings style as Enhanced graphics and exposes:

- AI asset profile;
- Preserve original micro-detail;
- Preserve stars & tiny lights;
- AI render meshes;
- saved OpenRAC texture count and backend status.

The Advanced section retains the local 2x/4x export path for official launchers that do not expose
the fork service.

## Use

1. Use the fork launcher containing the graphics-preparation service.
2. Install and enable `graphics-preparation-0.4.0.zip`.
3. The launcher asks once for permission to use the bounded graphics-preparation service.
4. In **Models and textures**, enable saving the game's textures and play the content you want to cover.
5. Open **Graphics preparation**.
6. Choose the AI profile and preservation options.
7. Press **Prepare AI graphics**.

The native backend writes/activates the prepared AI pack in OpenRAC's own texture-pack storage.
No Python helper or extra UI is needed.

## Stock launcher fallback

On a launcher without the service, the mod still works as the 0.3 series did: it reads OpenRAC's
saved textures, performs local 2x/4x scaling in the sandboxed page, and exports a normal texture-pack
ZIP for **Mods -> Add a mod**.

## Develop

```sh
node --test
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/package.py
```

GPL-3.0-or-later. No game/disc assets or neural model weights are included.
