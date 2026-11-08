Graphics preparation 0.16.1 finalizes the production staged material reconstruction and QA path.

- Material generation keeps the production order: Upscaled Diffuse -> Albedo Cleanup -> Coarse Height -> Mid Height -> Micro Height -> Height Merge -> Sobel Normal -> AO/Roughness -> optional Curvature.
- Bright Weapon/Energy emissive regions are detected before de-lighting so intentional emitters are protected from Albedo Cleanup.
- Material-family profiles now carry conservative Height/Normal strengths and parallax authoring scale hints; `material.json` explicitly marks runtime renderer support as required.
- Quality Lab adds a QA-only **Lit relief preview**, allowing Albedo/Normal/Roughness/AO/Specular/Emissive to be inspected as an actual lighting response. The preview is not included in normal pack output.
- Material QA records Normal mean/P50/P95/max tilt, flat/steep ratios, Height range, relief warnings, PBR validation and pipeline metadata. Normal percentiles use a bounded 0-90 degree histogram instead of per-pixel storage.
- Full-run progress now includes AI tiles, material-map generation, mip generation and pack writing before marking each texture complete. Cache hits do not inflate measured GPU throughput.
- Specialized detail-CNN architecture v2 preserves spatial dimensions through dilated residual blocks with matching dilation padding.
- Training resume is bound to scheduler state, architecture/configuration, fidelity weights and the exact dataset-manifest SHA-256, and writes ONNX training provenance metadata.
- Specialized CNN release validation uses the untouched test split for `release_candidate`; validation data remains diagnostic/model-selection data only.
- Standard/High/Max AI quality gates remain 90/94/97 and the deterministic fallback path remains unchanged.
- Stock OpenRAC still does not gain runtime parallax/displacement merely from these sidecars; the preparation output is ready for renderer integration without claiming unsupported runtime behavior.
