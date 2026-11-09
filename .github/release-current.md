Graphics preparation 0.21.2 completes the native OpenRAC geometry/material path and hardens the iMac workflow.

- Automatically recovers static texture sources from already extracted level PNGs when no runtime dump exists; existing runtime dumps are never overwritten.
- The mod UI now reports its actual manifest version instead of a stale hard-coded number.
- Declares the consented `graphics-preparation` launcher service so Geometry Enhancement can run from the normal mod page.
- Uses the native `ai.meshes` service when the launcher supports it, with the existing JSON/helper workflow retained only as a compatibility fallback.
- Keeps geometry generation offline and stages the complete result before activation.
- Imports geometry with `--strict`, so a refused mesh aborts the preparation instead of installing a partial override set.
- The OpenRAC launcher validates the generated render pack, rejects symlinks and any `collision.glb`, backs up the previous active geometry tree, then activates the verified `level_NN` overrides.
- The launcher automatically mounts the activated geometry from `prepared-graphics/meshes/<version>` on the next game start.
- Adds a bundled-Python fallback for standalone/macOS launcher installs.
- Enhanced material maps are enabled for key materials by default for new configurations; existing explicit Off choices remain respected.
- Generated Normal, Roughness, Height, AO, Emissive, Specular, Metallic, Cavity, Curvature and Edge-Wear sidecars keep the original texture hash layout expected by OpenRAC.
- Preserves the existing AI texture cache: material-sidecar rebuilding and geometry preparation do not invalidate the previous Real-ESRGAN results.
- Keeps the 0.21.0 asset-aware remesh, topology optimization, silhouette refinement, LOD planning, collision-safe defaults and bounded Height micro-displacement.
