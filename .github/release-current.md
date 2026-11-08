Graphics preparation 0.10.0 adds optional enhanced material-map generation.

- Generates deterministic Normal, Roughness, Height, AO and Emissive maps from the final 4x reconstruction.
- Material-aware priors tune surface response without changing the colour texture.
- Normal maps are vector-normalized; height uses restrained luminance structure; AO uses local valleys.
- Emissive extraction is conservative and material-sensitive.
- Sidecars use Materials/<hash>/ with material.json metadata.
- Modes: Off (default/current-stock compatible), Key materials, All eligible diffuse materials.
- Material maps are generated once per exact-content group and reused for duplicate output hashes.
- Pack metadata records generated sidecar set count.
- OpenRAC core branch feat/graphics-max-stack contains the matching material-sidecar registry/import infrastructure.
- Keeps Quality Lab, dual-CNN agreement, guarded recovery, WebGPU, cache, lighting/baker and effects.
