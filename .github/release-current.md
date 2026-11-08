Graphics preparation 0.11.0 completes the P0 texture-quality stack.

- Selective 8× internal master for important Max-detail character/weapon/boss/key-terrain assets, downsampled to 4× final.
- Three-band fine/mid/coarse source-frequency reconstruction.
- Extended QA: SSIM, histogram drift, alpha coverage, seam score, microdetail gain and hallucination-risk score.
- Automatic failure detection for black/transparent/wrong-size/alpha-loss/over-detail/CNN-disagreement outputs.
- Failure-rejected AI output never enters the persistent cache and falls back safely.
- Advanced sidecars: Specular, Metallic, Cavity, Curvature and Edge-Wear in addition to Normal/Roughness/Height/AO/Emissive.
- Quality Lab shows master scale, structural metrics, hallucination score and detected failure reasons.
- Cache pipeline version bumped for the new reconstruction and 8× master semantics.
