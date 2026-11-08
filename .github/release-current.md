Graphics preparation 0.13.0 adds adaptive reconstruction, directional source-detail recovery and safe interactive AI pause/resume.

- Smooth diffuse textures can use lower-overlap adaptive tile geometry while complex textures keep the full High/Max context.
- Cache records texture complexity and the selected tile geometry so resumed exports remain traceable.
- High/Max detail restoration adds an edge-aligned directional frequency band that recovers source variation without cross-edge halo sharpening.
- AI pack generation can pause only after a persisted texture-group checkpoint and resume without discarding cached progress or the active ZIP stream.
- Specialized CNN training now includes held-out learning smoke tests plus an isolated real-model quality benchmark workflow.
- Retains 0.12.2 PSNR and material-sidecar validation, SHA-verified specialized CNN refinement, Quality Lab, selective 8x masters and fail-safe recovery.
