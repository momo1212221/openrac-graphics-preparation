# Graphics preparation

Graphics preparation 0.17.0 runs the AI texture path on the **standard OpenRAC Dev Launcher**.

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
2. Install `graphics-preparation-0.17.0.zip`.
3. In **Models and textures**, enable **Save the game's textures while you play**.
4. Play the content whose textures you want to prepare.
5. Open **Graphics preparation**.
6. Choose Faithful, Balanced or Maximum Detail.
7. Choose whether to preserve micro-detail and stars/tiny lights.
8. Press **Prepare AI graphics**.
9. Choose where OpenRAC should save the generated texture-pack ZIP.
10. Add that ZIP through **Mods -> Add a mod**.

Step 10 is required because the stock Mod Tool protocol deliberately allows a mod page to save files
and no longer needs to install a second effects runtime: the native particle/glow/haze runtime is built into Graphics preparation 0.17.0.

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
rows are played by the **native runtime integrated into Graphics preparation**, built against OpenRAC SDK
1.14.2. It uses props and haze through the public API; it is not a launcher fork.

The stock Mod Tool API deliberately cannot overwrite extracted level source or launch the native
baker. Therefore **Export baker profile** saves the selected level's merged `probe-bake.json`;
place it in that exported level and run **Enhanced graphics -> Prepare lighting**. Runtime
point/spot lights and particle effects do not need a bake.


## Exact duplicate elimination (0.6.1)

Before a neural run, Graphics preparation now performs an exact-content duplicate pass. Files with
different sizes are known to be different without reading them twice. Same-size candidates receive
a fast fingerprint and are then compared byte-for-byte; the fingerprint is never trusted by itself.

Each unique PNG source is sent through Real-ESRGAN only once. The prepared result is immediately
written to every OpenRAC texture hash that referenced identical bytes, so the implementation does
not keep an entire 4x texture library in memory. The final summary reports unique sources, exact
duplicates and how many repeated AI passes were avoided.


## WebGPU acceleration (0.7.0)

AI acceleration defaults to **Auto**. Graphics preparation first attempts ONNX Runtime WebGPU and
runs Real-ESRGAN on the GPU when the OpenRAC WebView exposes WebGPU. If WebGPU is unavailable or
fails preflight/inference, Auto disables it for that run and continues with the optimized WASM
backend. Manual WebGPU-only and WASM-only modes are available for testing.

The release bundles both ORT execution paths locally. The WebGPU bridge stays single-threaded at the
WASM boundary so the custom-scheme WebView never needs an external worker/module bootstrap; the
heavy neural operators execute on WebGPU.


## Persistent resume cache (0.7.1)

When IndexedDB and Web Crypto are available, completed neural results are cached locally under the
mod page's own OpenRAC origin. Cache keys use SHA-256 of the source PNG plus the model/pipeline and
all output-affecting detail options. A cached result is written directly into a new texture pack
without running Real-ESRGAN again.

The cache is optional and fail-open: IndexedDB, quota or crypto failures disable it for the session
and never stop the export. A configurable 512 MB / 1 GB / 2 GB / 4 GB LRU budget evicts old results.
Only successful AI results are cached; 4x fallback/original outputs are intentionally not cached, so
a future run can retry the neural path.


## Lossless trivial-texture bypass (0.7.2)

Before neural inference, decoded source pixels are checked for two exact cases: every pixel is fully
transparent, or every RGBA pixel is identical. Those textures contain no detail for Real-ESRGAN to
reconstruct, so they are enlarged directly with no smoothing. No approximate variance threshold is
used; any visible colour/detail variation stays on the AI path.


## WebGPU graph capture + timing (0.7.3)

Auto acceleration now tries WebGPU with graph capture first. Real-ESRGAN uses a fixed 1x3x128x128
input, so successful capture can replay the same GPU command graph across the many tile inferences.
If capture is unsupported, the same run falls back to ordinary WebGPU; only a WebGPU failure falls
back to WASM.

The final summary records total AI compute time, average milliseconds per unique neural source and
tile count. These timings make device/backend comparisons visible without external profiling tools.


## High Detail CNN reconstruction (0.8.0)

0.8 separates **detail** from **sharpness**. The default is now Balanced CNN + High Detail.

- Standard keeps the prior 8px context / 112px core look.
- High uses 16px source context, a 96px useful core and 8px overlap.
- Max uses 24px source context, an 80px useful core and 16px overlap.
- Overlapping neural tiles are feather-weighted together instead of hard-overwritten.
- High cuts the old output-sharpen stage in half; Max disables that stage entirely.
- Additional visible structure comes from a bilinearly reconstructed multi-scale residual field
  derived from the original texture, not a stronger edge-sharpen filter.

Textures are classified conservatively. Interface assets keep Standard context. Normal maps and
technical masks bypass generative CNN reconstruction and use technical-safe 4x resizing; normal
vectors are re-normalized afterwards. World diffuse and sky textures use the selected detail mode.
The persistent cache key includes detail quality and coarse texture scope, so older/simpler outputs
cannot be reused accidentally.


## Dual-CNN material detail pipeline (0.9.0)

0.9 bundles a second local CNN, Real-ESRGAN General x4v3, beside the existing x4plus model.
Both receive the same fixed 128x128 source tile. x4plus remains the reconstruction base; the second
CNN acts as a fidelity/detail reference. Only its high-frequency residual is injected, and the gain
is multiplied by per-pixel agreement between the two CNN outputs. Large disagreement is treated as
possible hallucination and suppresses the extra detail.

Material routing adjusts that contribution for weapon, character, terrain, stone, metal, fabric,
organic, glass, energy, sky and generic surfaces. Normal/mask/UI safety rules remain in force.

A source-colour lock works in YCbCr: output luminance/detail is kept, while chroma is pulled toward
the original art. Quality metrics report colour/luma drift, alpha drift, edge gain, CNN agreement and
an aggregate 0-100 score. High-impact character/weapon/terrain sources are processed first so the
persistent cache retains the visually important work earliest.


## Quality Lab and guarded recovery (0.9.1)

Quality Lab previews any dumped texture before a full export, shows the automatic class/material,
dual-CNN agreement and quality metrics, and stores optional class/material overrides per texture
hash. Overrides participate in the persistent-cache key.

When Quality Guard sees a neural result below 45/100, the batch path automatically retries that
source conservatively (no second CNN, reduced detail context, source colour lock on) and keeps the
higher-scoring result. A bad aggressive reconstruction therefore does not have to poison a
multi-thousand-texture pack.


## Enhanced material sidecars (0.10.0)

The optional material-map generator derives five deterministic maps from the final high-resolution
colour reconstruction: normal, roughness, height, ambient occlusion and emissive. The generator is
material-aware but does not alter the colour texture. Normal vectors are normalized, roughness uses
conservative material priors plus local structure, AO responds to local valleys, and emissive only
selects sufficiently bright/saturated candidates.

Sidecars are written as:
`Materials/<texture-hash>/{normal,roughness,height,ao,emissive}.png` plus `material.json`.

This mode defaults to **Off** because the current public stock launcher predates that pack extension.
The OpenRAC core integration branch `feat/graphics-max-stack` adds importer/exporter validation and
renderer lookup while retaining backwards compatibility with ordinary texture packs.


### 0.10.1 fixes

- Energy/emissive extraction now recognises saturated hot-channel colours such as orange plasma
  without lowering the conservative threshold for ordinary diffuse textures.
- Quality Lab class/material overrides now propagate into the full batch export and its cache key,
  so preview and final pack use the same routing.


## Seam-aware CNN context (0.10.2)

Repeating world textures now compare opposite source edges with their local interior gradients.
When an edge is plausibly periodic, CNN padding wraps to the opposite side instead of clamping the
border pixel. This gives x4plus and the detail CNN real material context across texture boundaries,
reducing reconstructed seams without sharpening or modifying non-repeating UI/technical maps.


## Quality Lab+ (0.11.1)

Quality Lab now previews the derived Normal/Roughness/Height/AO/Emissive maps beside Original and AI
output. Per texture hash, the user can override the reconstruction quality to Current, High, Max or
No AI. These overrides are also respected by the full batch export, so a logo or fragile UI asset
can stay conservative while weapons, terrain or hero materials run at maximum detail.


## Adaptive quality policy (0.11.1)

Quality Guard now uses a shared policy instead of one fixed score cutoff. It considers aggregate score plus colour/luma drift, alpha drift, CNN agreement, edge amplification, texture class and material importance. Weak results are retried conservatively; critically bad uncached AI results are rejected and replaced by the deterministic 4x fallback. Quality Lab shows the verdict and recommended action before a full pack export.


## Automatic per-texture detail planning (0.11.1)

The global Detail reconstruction selector now includes **Auto**. Auto chooses a starting quality per texture from path scope, visual importance and source size: UI/technical maps stay conservative, important character/weapon assets may use Max, and ordinary world materials default to High. After the first neural pass, measured colour drift, edge gain, CNN agreement, material and class can trigger one refinement pass. Manual per-hash quality overrides always take precedence. Cache identity follows the quality actually written, so refined Max/High outputs cannot be restored under the wrong key.


## P0 quality completion (0.11.1)

0.11.1 closes the main texture-quality workstream. Important Max-detail assets can use a selective 8× internal master: the source is expanded 2×, reconstructed by the local CNN stack to 8× original resolution, then high-quality downsampled to the normal 4× pack size. Unsupported/oversized cases fail open to the established 4× path.

Source-detail restoration now uses three frequency bands (fine/mid/coarse) instead of a two-scale residual. Quality analysis adds approximate SSIM, histogram drift, alpha-coverage drift, seam score, microdetail gain and a hallucination-risk score. Automatic failure detection rejects catastrophic black/transparent/wrong-size/alpha-loss/over-detail/CNN-disagreement results before they enter the persistent cache.

Material sidecars now include Normal, Roughness, Height, AO, Emissive, Specular, Metallic, Cavity, Curvature and Edge-Wear. Existing sidecar names remain unchanged; the additional files are additive for newer OpenRAC integrations.


## Export quality report (0.11.1)

Every AI texture-pack export now includes `quality-report.json`. The report keeps a compact,
inspectable list of the 20 lowest-scoring outputs, the 20 highest-scoring outputs and every output
that triggered automatic failure detection or a degraded fallback. Rows include the texture
hash/path, class, material, actual detail quality, backend, master scale, cache state and measured
quality metrics. The pack manifest points to the report through `resilience.quality_report`.


## Specialized material CNN runtime (0.12.0)

Validated material-specific detail models can now refine Max-detail diffuse outputs after the general
4× reconstruction. The runtime loads only models registered in `models/specialized-models.json`,
verifies the downloaded ONNX bytes against the pinned SHA-256 before session creation, and routes by
the existing material classifier.

The specialized pass is deliberately fail-open. Missing registries/models, unsupported WebGPU,
model-load/inference errors, or a refinement that worsens the quality guardrails keep the established
general Real-ESRGAN result. Source alpha is preserved. Persistent cache identity includes the sorted
specialized-model registry hashes, so changing a promoted model cannot silently reuse stale outputs.


## Specialized quality-report metadata (0.12.1)

`quality-report.json` now records whether the material-specific refinement was accepted or rejected
for each retained row. Accepted rows include the exact pinned specialized-model SHA-256, so a visual
result can be traced back to the validated model that produced it.


## PSNR and material-sidecar validation (0.12.2)

Texture QA now records PSNR in addition to SSIM and the existing colour, histogram, edge, seam and
hallucination metrics. Generated material sidecars are checked for tangent-normal unit length/facing,
scalar-channel consistency and edge discontinuity. Results are written into each
`Materials/<hash>/material.json` and aggregated in `quality-report.json`.


## Adaptive reconstruction and interactive pause (0.13.0)

0.13.0 moves the remaining quality/performance work onto the current main line.

- Smooth diffuse textures can use reduced-overlap adaptive tile geometry while complex textures retain
  the full High/Max context windows. The chosen geometry and measured texture complexity are recorded
  with cached results.
- Source-detail restoration adds a directional edge-aligned frequency band. It samples along local
  edge tangents so High/Max can recover real source variation without turning cross-edge contrast into
  sharpening halos.
- AI pack generation can be paused safely after a completed texture-group checkpoint and resumed
  without discarding the active ZIP stream or persisted run state.
- CNN training now has executable held-out learning smoke tests and a separate real-model quality
  benchmark workflow in addition to runtime sanity checks.
- Material-sidecar validation and PSNR reporting from 0.12.2 remain enabled.


## Realism asset pipeline (0.15.0)

0.15.0 focuses on source-faithful realism rather than stronger sharpening.

- Coverage-aware alpha reconstruction preserves hard cutout coverage while keeping smoke, glow and
  other soft-alpha effects continuous. Low-alpha RGB dilation reduces dark or bright fringes around
  vegetation, particles, fences and similar textures.
- The direct 4× and selective 8×→4× paths validate alpha-edge coverage after the final resize.
- Optional enhanced-renderer mipmap sidecars are generated from the final high-resolution texture.
  Hard cutouts preserve alpha coverage across mip levels to reduce distance popping and shimmering.
- Dual-CNN fusion now includes regional support. Isolated detail confidence is reduced when the
  surrounding region does not confirm it, while coherent source-supported texture structure remains.
- Quality Guard v4 records regional low-confidence ratio and the 10th-percentile confidence floor and
  uses both when selecting Standard, High or Max reconstruction.
- Quality Lab exposes regional CNN confidence and alpha-edge metrics for manual QA.
- PBR material calibration constrains Roughness, Metallic and Specular together by material family,
  keeping dielectric surfaces near non-metallic values while allowing conductive metal and hybrid
  weapon surfaces to retain stronger reflections. Calibration and validation are written to the
  material sidecar and quality report.
- Material sidecars also include a conservative lighting-neutralized `albedo.png`. It removes only
  bounded low-frequency brightness bias, preserves alpha and RGB colour ratios, and protects emissive
  or strongly saturated regions. The normal stock diffuse texture is never replaced by this sidecar.

Enhanced mipmaps and material sidecars remain optional because the stock launcher does not yet
consume those extra renderer assets.

## Production runtime effect placement (0.15.0)

Runtime particle and haze authoring now uses OpenRAC's exported level structure directly:

- `manifest.json` supplies class metadata while `placements.json` supplies real tie/shrub/moby instance transforms;
- the placement UI has a separate level-instance selector, manual X/Y/Z entry, copy/paste, placement clearing and explicit confirmation;
- legacy saved effects keep their old coordinates but are migrated to **Needs placement** until the user confirms them once;
- unplaced effects, missing levels and malformed coordinates block export instead of silently becoming world-origin effects or disappearing;
- instance snapping stores a world-coordinate snapshot; it does not pretend to follow moving gameplay objects;
- live **Use player position** remains visibly unavailable until the stock Mod Tool protocol exposes player coordinates;
- authored particle/haze packs are executed by the native runtime inside Graphics preparation 0.17.0; no second runtime download is required.

The placement coordinates use the same column-major 4x4 transform convention as OpenRAC's official level export.


## Production staged material reconstruction (0.16.0)

The enhanced material path now uses one fixed, inspectable production order:

```text
Upscaled Diffuse
 -> Albedo Cleanup
 -> Coarse Height
 -> Mid Height
 -> Micro Height
 -> Height Merge
 -> Normal From Height
 -> AO / Roughness
 -> optional Curvature
```

The stages are deliberately separated. Coarse, mid and micro height bands are frequency-isolated
before merge, so absolute diffuse brightness is not treated as absolute geometry. Normal maps are
generated only from the merged relative height field using a 3x3 Sobel derivative. AO and roughness
are then derived from the reconstructed surface rather than from raw colour.

Production hardening in 0.16.0 adds:

- alpha-aware neighbourhood statistics, so hidden RGB outside cutout/transparent regions cannot bend
  height, normals, AO, cavity or edgewear at visible borders;
- source-emissive protection before albedo cleanup, preserving bright saturated weapon/energy emitters;
- material-family height profiles for terrain, stone, metal, fabric, organic, character, weapon,
  energy and generic surfaces;
- optional signed curvature as a separate sidecar;
- Quality Lab previews for Albedo, Coarse Height, Mid Height, Micro Height, merged Height, Normal,
  Roughness, AO and the remaining PBR helpers;
- production pipeline metadata version 2 in every material sidecar;
- validation of pipeline order, band statistics, merge centering, surface ranges, curvature
  consistency, normal length/facing, normal tilt, PBR calibration and alpha-safe reconstruction;
- parallax-ready height authoring metadata without forcing parallax at runtime;
- material QA output in the quality report so aggressive relief can be reviewed instead of silently
  shipped.

The intermediate Coarse/Mid/Micro maps are preview/QA products. Final texture packs keep the final
renderer sidecars only, avoiding unnecessary pack growth.

Curvature remains optional in the UI. Turning it off skips the sidecar and is recorded in
`material.json`, while Height, Normal, AO and Roughness continue to be generated identically.



## Final material and training hardening (0.16.1)

0.16.1 closes the production hardening pass around the staged material pipeline and long-running AI exports.

- Quality Lab adds a synthetic **Lit relief preview** built from Albedo, Normal, Roughness, AO,
  Specular and Emissive so reconstructed surface depth can be judged as lighting response instead of
  only inspecting the purple normal texture. This preview is QA-only and is not written into normal
  texture packs.
- Material QA reports mean/P50/P95/max tangent-normal tilt, flat/steep-normal ratios and final height
  range. Percentiles use a fixed 0–90 degree histogram, so QA does not allocate one angle value per
  output pixel on very large 4× textures.
- Height profiles include conservative parallax authoring scale hints. `material.json` declares
  `height.png` as a relative-height map with 0.5 neutral height and explicitly records that renderer
  support is still required. The stock renderer is not claimed to provide parallax or displacement.
- The full-run progress display now reserves progress for material-map generation, mip generation and
  pack writing. A texture reaches 100% only after its sidecars/output are finished, and cache hits do
  not masquerade as GPU throughput.
- Specialized detail-CNN architecture v2 now uses matching dilation padding, preserving spatial
  dimensions through every residual block. Training checkpoints also persist scheduler state and bind
  resume to the exact dataset-manifest SHA-256, architecture and fidelity weights.
- Specialized model release validation is test-only: the validation split remains diagnostic/model
  selection data, while `release_candidate` is decided only from the untouched test split.

The deterministic staged Height/Normal/PBR generator is production-ready in the preparation mod.
Actual runtime parallax/displacement still depends on OpenRAC renderer support for the exported
`Materials/<hash>/` sidecars.


## One-package runtime (0.17.0)

Graphics preparation is now one installable OpenRAC mod instead of a tool plus a separate native effects runtime.

- The same `graphics-preparation-0.17.0.zip` contains the launcher tool page, AI/WASM assets, the particle mesh and native runtime libraries.
- Native libraries are included for Linux x86_64/AArch64, macOS Intel/Apple Silicon and Windows x86_64.
- The mod remains a normal OpenRAC mod and uses the official 1.14 native API.
- Exported runtime-effect packs now require `graphics-preparation >= 0.17.0`; they no longer require `graphics-effects-runtime`.
- The old `Graphics Effects Runtime 0.1.x` release remains only for compatibility with older 0.15/0.16 installations and is not needed by 0.17+.
- Installing Graphics preparation once is enough for the editor and for authored Sparks, Smoke, Mist, Glow, Energy, Rain and Heat Haze.
