Graphics preparation 0.12.2 completes quantitative texture and material-sidecar validation.

- Texture QA now records PSNR alongside SSIM, colour/histogram drift, edge gain, seam risk and hallucination risk.
- Generated material maps are validated for tangent-normal length/facing, scalar-channel consistency and edge discontinuity.
- Each Materials/<hash>/material.json contains its sidecar quality result.
- quality-report.json aggregates material-map validation so problematic sidecars can be found without opening every material folder.
- Retains SHA-verified specialized material CNN refinement and 0.12.1 per-model traceability.
