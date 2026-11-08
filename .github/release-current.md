Graphics preparation 0.12.0 connects validated specialized material CNNs to the production runtime.

- Max-detail diffuse textures can receive a material-specific same-resolution refinement after the general 4× CNN path.
- Runtime routing uses the existing material classifier and promoted specialized-model registry.
- Every specialized ONNX payload is SHA-256 verified against its pinned registry entry before session creation.
- Missing/invalid models, backend failures and inference errors fail open to the established general CNN output.
- Specialized candidates are accepted only inside strict quality-score, hallucination-risk and colour-drift guardrails.
- Persistent cache identity includes the specialized model registry fingerprint.
- Source alpha is preserved and specialized runs/rejections are reported in batch statistics.
- Retains the 0.11.1 export quality report and the 0.11.0 selective 8×/material-sidecar stack.
