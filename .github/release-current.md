Graphics preparation 0.10.1 fixes the first material-sidecar build.

- Energy emissive detection now combines perceptual luminance with a material-gated peak-channel signal, so saturated orange/red/blue energy can emit without making ordinary diffuse textures glow.
- Full-pack processing now carries Quality Lab texture-class/material overrides into AI options and cache identity.
- Preview and batch therefore use identical manual routing.
- Keeps optional material sidecars Off by default for current stock-launcher compatibility.
