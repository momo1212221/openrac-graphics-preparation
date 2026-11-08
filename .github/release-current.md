Graphics preparation 0.7.0 adds GPU acceleration on top of exact duplicate elimination.

- Auto backend tries ONNX Runtime WebGPU first.
- On macOS/WebKit with WebGPU support, the GPU path maps through the platform WebGPU implementation instead of running all neural operators in CPU WASM.
- WebGPU startup/preflight failure automatically disables GPU for the current run and falls back to optimized WASM.
- If a WebGPU inference later fails, the existing fail-safe reset/retry path switches the retry to WASM in Auto mode.
- Manual WebGPU-only and WASM-only modes are available in the UI.
- Bundles ort.webgpu.bundle.min.mjs and the matching asyncify WebGPU bridge locally; no network access or custom launcher is required.
- Keeps exact content duplicate elimination, reusable tensor buffers, reduced UI yields, fixed 128x128 tiles, microdetail/stars restoration, lighting/baker authoring and effects support.
