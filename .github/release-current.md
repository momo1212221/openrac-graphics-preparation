Graphics preparation 0.21.0 adds asset-aware remeshing and deterministic LOD planning to the Modern / PS5 geometry path.

- Classifies compatible primitives as Character, Weapon, Rock, Foliage, Terrain, Structure or Prop/Generic.
- Uses role-specific automatic triangle-budget multipliers instead of treating every moby/scenery primitive alike.
- Characters, weapons and rocks get lower adaptive edge thresholds and higher silhouette/curvature priority.
- Foliage uses a tighter budget to avoid exploding alpha-card geometry.
- Adds safe **Triangle topology optimization**: a shared diagonal is flipped only when triangle quality improves, the surface stays below the crease threshold, face orientation remains valid and UV orientation is not reversed.
- Adds curvature-weighted **Silhouette refinement** on top of the existing volume-preserving shape pass.
- Hard creases and open boundaries remain pinned during silhouette refinement.
- Terrain and mobys keep the existing collision-safe position lock unless **Allow visual/collision mismatch** is explicitly enabled.
- The one-click **Modern / PS5 target** enables Asset-aware Remesh, Topology Optimization, Silhouette Refinement at 100%, LOD Planning and bounded Height micro-displacement together.
- Per-primitive reports now include asset role, effective role-specific triangle budget, topology quality/flips, silhouette-refinement QA and LOD policy.
- Emits a separate `geometry-lod-plan.json` with deterministic LOD0/LOD1/LOD2 integration targets from the actual subdivision stages.
- The stock OpenRAC assets importer currently accepts one replacement GLB per edited class, so 0.21.0 does not falsely claim runtime LOD switching. The high-detail remesh is already game-effective; the LOD plan is the explicit contract for the next importer/renderer integration.
- Existing Height sidecars, conservative Diffuse fallback, crease preservation, angle-weighted normals/tangents, UV/skinning interpolation, Quality Guard and collision QA remain intact.
