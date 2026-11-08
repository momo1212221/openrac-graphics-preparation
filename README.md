# Graphics preparation

Graphics preparation 0.5.3 runs the AI texture path on the **standard OpenRAC Dev Launcher**.

There is no custom launcher service, no Python helper and no external executable. The release ZIP
contains:

- Real-ESRGAN x4plus as an ONNX model;
- ONNX Runtime Web's bundled WASM module;
- the same Faithful / Balanced / Maximum Detail post-processing strengths used by the fork;
- the fork's micro-detail restoration and stars/tiny-lights preservation logic.

The standard OpenRAC Mod Tool page already permits scripts, WebAssembly and workers from the mod's
own folder while denying network and arbitrary filesystem access. The AI model and runtime are
therefore bundled inside the mod.

## Use

1. Install the normal current OpenRAC Dev Launcher.
2. Install `graphics-preparation-0.5.3.zip`.
3. In **Models and textures**, enable **Save the game's textures while you play**.
4. Play the content whose textures you want to prepare.
5. Open **Graphics preparation**.
6. Choose Faithful, Balanced or Maximum Detail.
7. Choose whether to preserve micro-detail and stars/tiny lights.
8. Press **Prepare AI graphics**.
9. Choose where OpenRAC should save the generated texture-pack ZIP.
10. Add that ZIP through **Mods -> Add a mod**.

Step 10 is required because the stock Mod Tool protocol deliberately allows a mod page to save files
but does not let it install or enable another mod automatically.

## AI implementation

Real-ESRGAN runs locally in the mod's iframe through ONNX Runtime Web/WASM. Version 0.5.3 uses the bundled ORT ESM build and passes the WASM binary directly, avoiding the nested dynamic module import that fails in macOS OpenRAC WebViews. Version 0.5.3 also pads every inference tile to the model's fixed 128x128 input shape, including small and edge textures. Input is processed in
fixed 128x128 model inputs with a 112x112 useful core so large PS2 textures do not require one enormous inference buffer.
After the 4x neural pass, the code restores source alpha and applies the fork's post-processing:

- Faithful: residual 0.28, sharpen 0.04
- Balanced: residual 0.44, sharpen 0.16
- Maximum Detail: residual 0.56, sharpen 0.30

Tiny bright stars/lights and high-contrast source microdetail are detected using the same thresholds
as the fork implementation.

## Compatibility fallback

The Advanced section still contains the fast local 2x/4x non-AI scaler. It uses only stock OpenRAC
Mod Tool calls as well.

## Build

The release workflow pins ONNX Runtime Web 1.31.1 and a pinned Real-ESRGAN x4plus ONNX artifact,
verifies the model SHA-256, then packages the runtime, WASM and model into the release ZIP.

GPL-3.0-or-later for this mod's code. Third-party runtime/model components keep their own licenses.
No game/disc assets are included.


## Lighting, baker and effects (0.6)

Graphics preparation also authors standard Enhanced graphics data:

- runtime point/spot lights in `assets/object-lights.json`;
- bake-only rectangular lights and GI/probe settings in `probe-bake.json`;
- particle presets in `graphics-effects.tsv`.

The point/spot lights are read by the official Enhanced renderer from normal mod assets. Particle
rows are played by **Graphics Effects Runtime**, a normal OpenRAC native mod built against SDK
1.14.2. It uses props and haze through the public API; it is not a launcher fork.

The stock Mod Tool API deliberately cannot overwrite extracted level source or launch the native
baker. Therefore **Export baker profile** saves the selected level's merged `probe-bake.json`;
place it in that exported level and run **Enhanced graphics -> Prepare lighting**. Runtime
point/spot lights and particle effects do not need a bake.
