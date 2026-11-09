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
