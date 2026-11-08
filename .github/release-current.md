Graphics preparation 0.5.0 runs real AI upscaling on the stock OpenRAC Dev Launcher.

- No custom launcher service.
- No Python helper.
- No external Upscayl application required.
- Bundles Real-ESRGAN x4plus ONNX and ONNX Runtime Web/WASM in the mod.
- Faithful, Balanced and Maximum Detail profiles.
- Same fork-style micro-detail restoration strengths and sharpening.
- Same stars/tiny-lights preservation thresholds.
- 96x96 tiled inference with overlap to control memory.
- Reads only OpenRAC's normal saved texture dump through the stock Mod Tool API.
- Writes a standard OpenRAC texture-pack ZIP through the stock streaming save API.
- Keeps the fast non-AI 2x/4x fallback in Advanced.

Because the official Mod Tool API intentionally cannot install another mod, the generated ZIP still
needs to be added through Mods -> Add a mod after processing.
