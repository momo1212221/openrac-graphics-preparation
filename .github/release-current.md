Graphics preparation 0.14.0 adds the first realism-focused asset pipeline.

- Coverage-aware alpha reconstruction preserves cutout silhouette coverage and soft transparency while reducing colour fringes.
- Alpha fidelity is revalidated after both direct 4x output and selective 8x-to-4x master downsampling.
- Optional enhanced mipmap sidecars preserve cutout alpha coverage across distance levels.
- Regional CNN confidence suppresses isolated unsupported detail while retaining coherent source-supported structure.
- Quality Guard v4 uses regional low-confidence ratio and confidence P10 in tier selection, recovery and failure detection.
- Quality Lab exposes regional confidence plus alpha coverage/error metrics.
- PBR material calibration constrains Roughness, Metallic and Specular as one material workflow and records validation metadata in material sidecars.
- Retains adaptive tile context, directional source-detail reconstruction, specialized CNN validation, material sidecars, Quality Lab, safe pause/resume and fail-safe recovery.
