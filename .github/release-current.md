Graphics preparation 0.7.3 adds WebGPU graph capture and built-in timing.

- Auto backend order is now WebGPU + graph capture -> plain WebGPU -> optimized WASM.
- Fixed 128x128 Real-ESRGAN input is suitable for graph capture; successful capture replays GPU command work across repeated tile runs.
- Capture failure disables only graph capture, not the whole GPU path.
- Plain WebGPU failure then falls back to WASM in Auto mode.
- The per-texture fail-safe retry can step down the same hierarchy during a long run.
- Final stats report AI compute seconds, average ms per unique AI source and total neural tile count.
- Keeps persistent resume cache, exact duplicate elimination, trivial-texture bypass and all lighting/baker/effects features.
