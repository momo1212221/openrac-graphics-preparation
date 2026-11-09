Graphics preparation 0.19.0 improves both handling and modern-graphics quality around the PS5-style target.

- Adds a one-click **Modern / PS5 target** preset to the main launcher tool page.
- The global preset enables Enhanced AI, Auto detail, dual-CNN fidelity gating, source-colour lock, Quality Guard, selective 8x masters, key material sidecars/mipmaps and the Modern geometry profile.
- Adds the **Modern** geometry profile with higher per-asset automatic triangle budgets.
- Adaptive subdivision now spends triangles on long and/or strongly curved edges instead of uniformly multiplying every triangle.
- Shared-edge selection is global, preventing T-junction cracks between neighbouring triangles.
- Adds configurable **Crease preservation** with automatic per-asset defaults.
- Hard shading creases are split into separate vertices before normal generation instead of being incorrectly smoothed together.
- Rebuilt normals and tangents are corner-angle weighted, improving highlight stability after adaptive tessellation.
- Shape refinement is crease-aware and does not smooth pinned hard edges.
- The Modern preset may refine safe static scenery, while moby/terrain position movement remains locked unless visual/collision mismatch is explicitly enabled.
- `geometry-report.json` moves to format 2 and reports changed/skipped primitives, skip reasons, adaptive edges, crease splits, budget-limited primitives, triangle totals and collision-review candidates.
- The helper summary prints those quality metrics directly after a geometry run.
- Existing UV, vertex-colour and skin-weight interpolation, original skeleton/animation authority, morph-target safety and official OpenRAC `assets.py` round trip remain intact.
- Texture AI remains independently resumable from the persistent cache; changing geometry does not rerun completed texture inference.
- This release intentionally does not invent fake high-frequency vertex noise. True material-aware Height -> micro-displacement is the next geometry-quality stage.
