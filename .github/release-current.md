Graphics preparation 0.5.2 fixes Real-ESRGAN inference on small and edge textures.

- Fixes: "Got invalid dimensions for input: image ... Got: 32 Expected: 128".
- The pinned Real-ESRGAN x4plus ONNX model receives exactly 128x128 RGB input on every inference.
- Uses a 112x112 useful tile core with 8-pixel context on every side.
- Missing context at texture edges is edge-clamped, never resized or filled with black.
- Works for tiny textures such as 16x16 and 32x32 as well as large textures.
- Keeps the 0.5.1 macOS WebView loader fix: bundled ORT ESM module, direct WASM binary, one thread, no proxy worker.
- Still runs on the stock OpenRAC Dev Launcher with no custom launcher service, Python helper or external application.
