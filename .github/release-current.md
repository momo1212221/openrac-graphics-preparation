Graphics preparation 0.10.3 extends Quality Lab.

- Preview now shows Normal, Roughness, Height, AO and Emissive maps for eligible diffuse outputs.
- Per-hash quality override: Auto/global, Current, High, Max or No AI.
- Full batch export respects the same per-hash quality choice.
- No AI uses the deterministic 4x fallback for that exact texture instead of invoking either CNN.
- Existing per-hash class/material overrides continue to participate in cache identity.
- Keeps seam-aware context, dual-CNN detail, persistent cache, quality guard and optional core-side material maps.
