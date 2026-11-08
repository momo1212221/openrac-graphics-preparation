Graphics preparation 0.5.1 fixes AI startup on the stock macOS OpenRAC Dev Launcher.

- Fixes the 0.5.0 error: "Importing a module script failed."
- Uses ONNX Runtime Web's bundled WASM ESM build instead of dynamically importing the external Emscripten module at runtime.
- Passes the local WASM binary directly through ort.env.wasm.wasmBinary.
- Forces single-threaded, non-proxy execution for the OpenRAC custom-scheme WebView.
- Keeps Real-ESRGAN x4plus, Faithful/Balanced/Maximum Detail, micro-detail restoration and stars/tiny-lights preservation.
- Still uses only the stock OpenRAC Mod Tool API; no custom launcher, Python helper or external app is required.
