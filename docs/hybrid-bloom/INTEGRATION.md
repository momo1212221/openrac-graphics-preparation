# Material CNN integration contract for OpenRAC Graphics Preparation

## Observed repository structure (GitHub, 2026-11-10)

- `src/material-maps.js` currently generates an `emissive` image using
  `deriveEmissiveFromSource` before `deriveAlbedoSidecar` so lamps are protected
  against albedo de-lighting. Keep that order.
- The mod already has ONNX Runtime Web inference in `src/ai-runtime.js` for
  texture upscaling and specialized detail models; these are **not** trained
  emissive-segmentation models.
- The existing `src/ai-cache.js` keys are specific to AI upscaling. Do not
  invalidate or replace them to support material masks.
- OpenRAC's `port/enhanced/renderer/material_response.cpp` reads authored
  `emission.texture` and `emission.runtime_intensity` properties, but this is
  not proof the requested CNN sidecar is yet bound to every GPU material.
- Bloom currently reads an SDR frame and uses `RGBA8` intermediate images,
  so truly overbright HDR Bloom needs separate renderer work.

## Required trained ONNX model signature

Input: `float32 [1,3,128,128]` with channel-first sRGB (R,G,B) values in 0..1.
Output: `float32 [1,1,128,128]` **pixel-aligned** per-pixel emissive class
probabilities in 0..1, or logits declared with `outputEncoding:'logit'`.
One output channel denotes probability that this texture pixel is truly emissive;
NOT reflected light, white-painted materials or foliage. Train the model against
hand-labelled emission masks. A detail-upscaling model is not interchangeable.

The adapter extracts a central 96x96 prediction from each 128x128 inference
tile, using 16px source context per side. 2D images of arbitrary size up to
16,384px/64MP work without resizing or fixed aspect ratio. Alpha<16 is zeroed.

### Minimal end-to-end example (when a model exists)

```js
import {predictEmissiveProbabilities} from './emissive-onnx-adapter.js';
import {fuseEmissivePrediction} from './emissive-cnn-fusion.js';

// `ort` and `session` are provided by your verified offline ONNX loader.
// `sourceImage`: original upscaled RGBA8 image (the cached output).
// `heuristicEmissive`: existing rule-derived emissive RGBA8 image.
const prediction = await predictEmissiveProbabilities({
  image:sourceImage, ort, session,
  onProgress:({done,total})=>showCnnProgress(done,total),
});
const fused = fuseEmissivePrediction({
  source:sourceImage,
  heuristic:heuristicEmissive,
  material:'energy',
  prediction,
  modelSha256:verifiedModelSha256,
  mode:'augment',
});
// Use fused.emissive as the material's emissive sidecar BEFORE albedo cleanup.
// Persist only as a separate versioned sidecar, not as a replacement diffuse.
```

### Wiring to `src/material-maps.js` (hook implemented in this feature branch)

1. `deriveMaterialMaps()` remains synchronous and now accepts `options.emissivePrediction`.
   The future verified loader must run inference in the async call path before invoking this function.
2. Implemented: after `deriveEmissiveFromSource`, the material pipeline passes original `image`, the
   heuristic mask, and optional `options.emissivePrediction` to `fuseEmissivePrediction()`.
3. Implemented: the fused mask is used for both `deriveAlbedoSidecar(image,emissive,...)` and
   final `maps.emissive`, protecting newly recognized emitters against albedo removal.
4. Implemented: `emissiveCnn` report is returned in material map and PNG outputs only when a
   prediction is supplied. No prediction retains the exact original heuristic mask.
5. Preserve current map generation when the option is missing; do not bump
   `MATERIAL_PIPELINE_VERSION` or alter AI-upscale cache keys for this optional
   feature. If caching a model result, create a **separate** key containing
   source-content hash + model SHA-256 + fusion version + settings.
6. Keep the model opt-in by default. A user may enable `verify` only after
   checking false negatives; it suppresses low-confidence heuristic emission
   on generic/foliage-like materials. `augment` never suppresses historical
   emission and is the safer first rollout.

### Failure and QA rules

- If a model is absent, fails to load, returns NaN or incorrect dimensions,
  preserve the previous rule-generated emissive sidecar and display a warning.
- Never send game assets to a cloud inference endpoint. Run locally with
  an independently verified ONNX model.
- Maintain alpha, colour hue and UV orientation; no bloom generated for the HUD.
- Use a labelled validation set with lamps, plasma, weapon LEDs, ordinary
  green plants, painted white walls, bright clouds, glass, transparency and
  small 1-2px emitters. Report precision, recall and false-positive count by
  material; a handful of synthetic tests is insufficient.
- Compare explicit screenshots and GPU timestamps on the real M2, Steam Deck
  and RTX hardware. Offline CNN does not run per frame and therefore must not
  contribute to frame time. The trained model's offline processing duration
  must still be reported to users.

## Contract with the independent Bloom/HDR renderer agent

- The offline exporter emits a source-aligned RGBA emissive PNG plus model
  identity, a measured QA report and a separate, explicitly authored runtime
  emission intensity; never bake HDR intensity by clipping into a PNG.
- Renderer agent: load the emissive texture **from a verified material identity**
  using the port's existing `emission.texture` property, not a guessed hash
  or a global brightness threshold. Convert sampling into the renderer's
  linear scene-light domain. Do not claim an RGB8 source becomes HDR merely
  by selecting an HDR output texture.
- Keep overbright scene-light values through emission injection, bloom
  downsample/upsample and composite; tone-map with AgX **after** Bloom.
  Do not threshold the display-referred 8-bit scene or apply Bloom to the HUD.
- Shader path should include fallback to ordinary existing Bloom when the
  emissive mask is missing. Neural-Bloom inference at runtime remains a
  separate optional benchmark, not a prerequisite for this integration.
- Keep the official OpenRAC upstream untouched. The user has explicitly approved commits to
  their own PUBLIC fork; no automatic upstream PR or merge is authorized.
