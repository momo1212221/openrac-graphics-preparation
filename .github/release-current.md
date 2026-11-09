Graphics preparation 0.17.3 preserves the user's previous AI upscale while making the staged material maps easy to add afterwards.

- Adds **Add materials to last AI run** to the normal OpenRAC Mod Tool page.
- The material rebuild never starts Real-ESRGAN or the detail CNN. It reads the existing persistent AI cache and generates the staged Albedo/Height/Normal/AO/Roughness/Curvature sidecars from those cached 4x pixels.
- Auto-detail exports can recover an existing Standard/High/Max cache entry instead of requiring the current automatic planner to choose the exact same quality tier.
- A cache miss in this special rebuild path uses the deterministic 4x fallback only; it never silently launches a new AI inference pass.
- The existing IndexedDB database, cache-key pipeline identity and completed-run record are unchanged. Upgrading from 0.17.2 does not clear or migrate the user's cached AI results.
- The saved pack records `ai_cache_only_material_rebuild: true` and `material_maps_mode: all-from-last-ai-cache` so it is auditable.
- Normal/Roughness/AO/Height still require OpenRAC's enhanced material-sidecar renderer to affect live lighting; the generated maps themselves remain deterministic and inspectable in Quality Lab.
- Existing one-package native runtime, particles/glow/haze, CNN models, quality guard, duplicate elimination and resume behavior are unchanged.
