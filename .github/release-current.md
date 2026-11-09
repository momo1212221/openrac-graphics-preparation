Graphics preparation 0.18.0 adds the first production Geometry Enhancement pipeline on top of the existing texture/material stack.

- Adds a **3D Geometry Enhancement** panel to the normal launcher tool page.
- Exports `ai.meshes` jobs with profile, asset scope, triangle budget, shape-refinement and collision-safety settings.
- Ships the production helper inside the release: `helper/openrac_graphics_helper.py` and `helper/geometry_enhance.py`.
- Uses OpenRAC's official `editor/assets.py export/import` glTF round trip and emits a normal overrides-pack ZIP.
- **Enhanced** rebuilds normals/tangent space without topology growth.
- **High** performs one crack-free midpoint subdivision pass.
- **Ultra** performs up to two passes while respecting per-asset triangle budgets.
- UVs, vertex colours, joint indices and normalized skin weights are interpolated for generated vertices.
- Original skeletons/animations remain authoritative; the helper never invents bones or imports new animation data.
- Existing tangents are regenerated from new positions, UVs and normals.
- Morph targets, unknown attributes, malformed primitives and missing UVs are skipped instead of silently rewritten.
- Shape refinement remains Off by default; with it Off, original positions stay exact and collision alignment is unchanged.
- Moby/terrain position movement is separately protected unless the user explicitly allows visual/collision mismatch.
- Writes `geometry-report.json` with file/primitive counts, before/after triangle totals, applied subdivision levels, budget limits, vertex-motion metrics and collision-review candidates.
- Geometry runs independently from the existing texture AI cache; adding geometry does not rerun the user's saved texture pass.
- Texture AI, material maps, cached material rebuild, native effects runtime and launcher-native platform release assets remain unchanged.
