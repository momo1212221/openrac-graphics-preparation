Graphics preparation 0.16.0 completes the production staged material reconstruction path.

- Material generation now follows one fixed order: Upscaled Diffuse -> Albedo Cleanup -> Coarse Height -> Mid Height -> Micro Height -> Height Merge -> Normal From Height -> AO/Roughness -> optional Curvature.
- Coarse, mid and micro relief are separated before merge; raw diffuse brightness is no longer used directly as absolute height.
- Normal maps are generated only from merged height with a 3x3 Sobel derivative.
- AO, Roughness, Cavity and Edgewear are derived from reconstructed relative geometry.
- Transparent/cutout RGB is excluded from neighbourhood statistics and cannot create false height or normal edges.
- Bright saturated Weapon/Energy emitters are detected before Albedo Cleanup and protected from de-lighting.
- Curvature is independently optional and its presence is checked against pipeline metadata.
- Material pipeline metadata is versioned as v2 and records band energies, merge/surface statistics, emissive protection, curvature state and parallax authoring hints.
- Material QA validates pipeline order/version, band statistics, height centering/range, AO/Roughness ranges, normal length/facing/tilt and PBR calibration.
- Quality Lab previews Albedo, Coarse/Mid/Micro Height, merged Height, Normal, Roughness, AO and remaining material sidecars and exposes the production validation result.
- Intermediate Coarse/Mid/Micro maps remain QA previews and are not added to final texture packs.
- Standard/High/Max AI texture gates remain 90/94/97; no existing quality threshold was weakened.
- Runtime effects, placement validation, duplicate elimination, persistent AI cache and CNN quality protections from 0.15.1 remain enabled.
