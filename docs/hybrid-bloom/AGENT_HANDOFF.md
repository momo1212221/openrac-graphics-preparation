# Handoff to the agent currently working on OpenRAC Bloom

## Division of responsibilities

- **Current renderer agent:** own OpenRAC `port/enhanced/renderer/bloom.*`,
  `port/enhanced/renderer/shaders/bloom*`, `scene_frame.cpp`, Vulkan/HDR changes,
  game-side settings, and the real M2 runtime check. Do not overwrite its work.
- **This branch:** optional **offline material-emission segmentation adapter**
  for `momo1212221/openrac-graphics-preparation` only. No renderer edits.
- **Shared handoff point:** a verified material ID selects a prepared emissive
  texture with authored scene-linear intensity. Shader-side use is the
  renderer agent's task; this package does not pretend to make it work today.

## GitHub privacy

Both `momo1212221/OpenRAC` and `momo1212221/openrac-graphics-preparation` are PUBLIC forks. The owner explicitly authorized pushing this code to their fork but NOT to official upstream OpenRAC. The feature branch and draft PR are publicly visible. Do not commit proprietary model weights, private ROM assets, or unlicensed training data.

## What already works

- 22 Node built-in test cases passed locally on the handoff package with fake ONNX sessions (not live-model quality or game tests).
- 128x128 tiled inference adapter handles arbitrary dimensions and edges.
- CNN probabilities are fused with existing rule-based RGBA8 emissive images.
- Foliage-green false positives are blocked by default; declared energy
  materials and explicit user overrides allow green LEDs.
- Disabled mode, invalid model outputs and runtime errors preserve original
  heuristic emission and do not modify existing AI upscaled texture cache.
- Model SHA-256 identity is accepted and validated at the fusion boundary;
  the actual model loader must independently verify binary hashes before use.

## Not implemented (must not be represented as complete)

1. A trained, evaluated semantic emissive segmentation ONNX model and dataset.
2. A verified ONNX loader and background inference call that passes an `emissivePrediction`
   to the opt-in hook now present in this feature branch's `src/material-maps.js`.
3. Exporter pack mapping, per-material runtime intensity, and confirmed
   loader identity in OpenRAC (renderer agent).
4. True HDR bloom on a linear floating-point render chain, optical halo,
   convolution PSF, in-game comparison, and 60 FPS performance validation.
5. Per-frame neural bloom (only investigate if standard GPU Bloom benchmarks
   justify it).

## Acceptance criteria before a real release

- Validated model from **local** labelled game assets only; train/test split
  by scene/texture family, not random crops of the same base texture.
- The no-CNN configuration produces byte-identical emissive output and uses
  existing upscaler cache without cache-key changes.
- High-confidence model masks preserve tiny emitters and transparency;
  false-positive green foliage and white non-emissive panels are measured.
- Real game capture on M2 shows visible before/after and glow-only diagnostic,
  shader logs and frame GPU timings. Repeat on Steam Deck and RTX.
- No changes to the official OpenRAC repository. The owner approved this fork-only branch.
