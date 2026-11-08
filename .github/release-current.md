Graphics preparation 0.15.1 is the production-hardening patch for runtime effect placement and the AI/material quality gates.

- Runtime Sparks, Smoke, Mist, Glow, Energy, Rain and Heat Haze now require deliberate placement; new effects no longer auto-snap to a preselected instance.
- Level-instance snapping uses OpenRAC `placements.json` world transforms for real tie/shrub/moby instances, while manual X/Y/Z remains available.
- Empty or invalid numeric placement input no longer silently becomes zero; unplaced, malformed or orphaned effects block export with actionable UI.
- Legacy authoring data preserves coordinates but requires one explicit placement confirmation after migration.
- Authored effects require Graphics Effects Runtime >=0.1.2.
- Graphics Effects Runtime 0.1.2 removes live props on level changes, clears haze outside gameplay and applies emitter Gravity as real per-frame acceleration.
- The native runtime is built and merged successfully for Linux x86_64/AArch64, macOS x86_64/ARM64 and Windows x86_64.
- The real CNN quality benchmark now compares the fusion in the same RGBA8/ImageData domain used by the browser runtime, eliminating false float-to-8-bit regression signals.
- Generic second-CNN novelty is disabled for benchmark-fragile Character, Weapon, Glass, Energy and Sky materials; x4plus remains authoritative there.
- Weapon emissive regions are detected before albedo cleanup so bright saturated emitters stay protected.
- Standard/High/Max texture gates remain 90/94/97; no quality threshold was weakened.
