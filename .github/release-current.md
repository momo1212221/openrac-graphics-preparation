Graphics preparation 0.8.0 adds High Detail CNN reconstruction without simply sharpening the image.

- New Detail reconstruction control: Current look / High detail / Max detail.
- Balanced CNN + High detail is the new default.
- High: 16px context, 96px core, 8px overlap.
- Max: 24px context, 80px core, 16px overlap.
- Overlapping tiles use feather-weighted blending to remove hard tile boundaries.
- High halves the previous post-sharpen contribution; Max disables that sharpening stage entirely.
- Extra texture richness comes from multi-scale source residual reconstruction (fine + mid-frequency structure) blended across the 4x output.
- Conservative texture classification: UI stays on the established path; normal maps and technical masks use safe non-generative upscaling; normal vectors are re-normalized.
- Sky/world diffuse textures receive the chosen CNN detail reconstruction.
- Cache keys now include adaptive-context/detail pipeline version, detail quality and texture scope.
- Keeps WebGPU graph capture, persistent cache, exact duplicate elimination, fail-safe fallback, lighting/baker and particle authoring.
