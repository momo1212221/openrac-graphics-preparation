# Hybrid Bloom: offline emissive CNN handoff

**Status:** opt-in integration scaffolding in the owner's Graphics Preparation fork, not a trained model or a working OpenRAC HDR release.

## What is committed on this feature branch

- src/emissive-onnx-adapter.js: local ONNX Runtime inference adapter for 128x128 RGB tiles with 16px context and same-resolution 1-channel probabilities.
- src/emissive-cnn-fusion.js: merges an optional CNN mask with existing heuristic emission while protecting alpha, ordinary foliage and previous emissive results.
- src/emissive-offline.js: optional inference orchestrator with a safe rule-based fallback.
- src/material-maps.js: **opt-in hook** accepting options.emissivePrediction *before* de-lighting; default behavior, map naming and AI upscale cache identity are unchanged.
- Four tests/emissive-*.test.mjs test files and detailed handoff/integration documents.

There is deliberately **no bundled model, training asset, image upload, live web inference, runtime renderer edit or upstream OpenRAC PR**.

## Safe opt-in example

Within the existing material generation pipeline, once a verified local segmentation model has returned its pixel-aligned probability mask, pass it into:

    deriveMaterialMaps(upscaledRgba, materialType, {
      emissivePrediction: {width, height, probabilities},
      emissiveCnnMode: 'augment',
      emissiveCnnConfidence: 0.94,
      emissiveCnnModelSha256: verifiedModelSha,
    });

Without emissivePrediction the code uses the historical emission exactly as before. Only the verify mode may remove low-confidence heuristically emissive pixels, and only on specific non-energy material families.

## Test

    node --test tests/emissive-*.test.mjs

The original three module test files passed locally (22/22) using mock ONNX sessions. The additional material integration test needs validation against the current whole repository/CI. Tests are not evidence of model quality, 60fps, or gameplay bloom.

## Follow-up for the other agent

1. Train and evaluate a segmentation model on licensed, locally held materials. **No unverified weights or extracted game assets in a public branch.**
2. Verify ONNX file SHA256 independently, inject ort/session into offline inference, then supply emissivePrediction. Keep the source texture cache untouched.
3. Produce per-material emission assets with verified material IDs and explicitly authored scene-linear emission intensity.
4. Integrate into OpenRAC's real Vulkan/Metal renderer and preserve scene-linear overbright values through bloom and tone mapping.
5. Compare on real M2/Steam Deck/RTX hardware and measure false-positive foliage, high-confidence tiny emitters and actual GPU frame time.

This branch is in momo1212221/openrac-graphics-preparation only; its official upstreams and the owner's main are unchanged. **This fork and branch are public.** Do not merge until the collaborating agent reviews and tests the interface.

See [AGENT_HANDOFF.md](AGENT_HANDOFF.md) and [INTEGRATION.md](INTEGRATION.md).


## Runnable experimental CNN build (fork only)

**Build:** Graphics preparation 0.21.5, feature branch
`feat/hybrid-bloom-cnn-usable-20261110`.

The user-facing UI now has **Experimental CNN emissive masks** and a sensitivity
selector under **AI asset enhancement**. It runs a bundled three-layer convolution
classifier (procedural synthetic training only, `synthetic-cnn-20261110-v1`)
on upscaled textures during material-PNG export. The classifier uses a bounded
128-pixel inference working size, emits full-size per-texel probabilities and
fuses them with the existing emissive rules. Failure preserves the old map.
There is no network request or GPU inference for this CNN.

**To reuse previous work:** install the CI's macOS-arm64 mod ZIP (or a locally
built installable package), open Graphics preparation, enable **Enhanced material maps**,
enable **Experimental CNN emissive masks**, choose **Balanced** (or conservative)
and click **Add materials to last AI run**. This reuses the already cached
Real-ESRGAN textures rather than rerunning the previous upscale pass.
The resulting texture pack includes `Materials/<hash>/emissive.png` and
the `emissiveCnn` model/status in `material.json`. Install that generated
pack in the standard OpenRAC launcher.

**Important limitation:** The HQ Bloom renderer in
`momo1212221/OpenRAC:test/bloom-hq-hybrid-20261110` has FP16 multi-level
screen-space bloom, **but has not yet been validated as consuming the material
emissive sidecars in its live lighting path**. The offline CNN is usable
now for authoring material masks; whether it changes the in-game Bloom still
requires the separate runtime importer/material-ID and HDR emission bridge.
Do not call this an end-to-end neural-Bloom release. The synthetic model is
experimental and is not a substitute for training/evaluation on licensed
gameplay captures.

**Build artifact:** see the branch's GitHub Actions workflow
`Hybrid Bloom CNN macOS test package` and download the
`graphics-preparation-0.21.5-macos-arm64-hybrid-cnn` artifact after
all checks pass. Add the enclosed ZIP to Mods → Add a mod. The official
OpenRAC project and the user's main branches are unchanged.
