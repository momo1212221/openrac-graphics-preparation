Graphics preparation 0.9.0 begins the maximum-quality stack.

- Adds a second bundled CNN: Real-ESRGAN General x4v3, pinned by SHA-256.
- x4plus remains the reconstruction CNN; General-x4v3 acts as a fidelity/detail CNN.
- Detail fusion injects only the second CNN's local high-frequency residual.
- Per-pixel CNN disagreement reduces or removes that contribution, providing an anti-hallucination confidence gate.
- Conservative material routing covers weapon, character, terrain, stone, metal, fabric, organic, glass, energy, sky and generic surfaces.
- Material-specific detail gains avoid over-processing glass/energy/characters while giving stone/terrain/fabric more reconstruction.
- Source-colour lock preserves original chroma while keeping reconstructed luminance/detail.
- Quality guard scores colour drift, luminance drift, alpha drift, edge gain and CNN agreement.
- Final pack metadata reports material counts, dual-CNN usage, agreement-gated detail pixels and average quality score.
- Processing is impact-prioritized so character/weapon/terrain work reaches the persistent cache first.
- Keeps WebGPU graph capture, WASM fallback, exact duplicate elimination, persistent cache, lighting/baker and effects authoring.
