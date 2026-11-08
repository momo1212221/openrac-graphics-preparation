Graphics preparation 0.7.2 adds a lossless trivial-texture bypass.

- Fully transparent textures skip Real-ESRGAN.
- Exactly uniform RGBA textures skip Real-ESRGAN.
- The bypass is exact, not heuristic: any visible pixel variation stays on the neural path.
- Bypassed textures use direct unsmoothed 4x enlargement, preserving their source content exactly.
- Final stats report how many outputs avoided AI through this fast path.
- Keeps WebGPU -> WASM Auto acceleration, persistent resume cache, exact duplicate elimination and all fail-safe/light/baker/effects features.
