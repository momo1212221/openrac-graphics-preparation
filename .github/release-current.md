Graphics preparation 0.10.5 adds automatic per-texture detail planning.

- New Auto detail mode chooses Current/High/Max per texture from scope, importance and source size.
- Important character and weapon assets can receive Max automatically; UI and technical maps stay conservative.
- Quality metrics can trigger one measured refinement pass after the initial reconstruction.
- Manual per-texture quality overrides remain authoritative.
- Adaptive Quality Guard still retries weak results and rejects critically poor uncached neural output.
- Cache keys now follow the quality actually stored after refinement.
- Fixes stale material-sidecar and UI version metadata.
