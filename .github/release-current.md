Graphics preparation 0.9.1 adds interactive QA and guarded automatic recovery.

- Quality Lab previews any dumped texture as Original vs AI output.
- Shows texture class, material route, 0-100 quality score, CNN agreement, colour drift, edge gain, detail pixels and backend.
- Per-hash manual texture-class and material overrides are persisted through the standard Mod Tool store.
- Overrides invalidate the AI cache identity so stale results cannot be reused.
- Quality Guard now actively recovers suspicious outputs: scores below 45/100 trigger one conservative rerun without the second CNN and with reduced detail context.
- The better-scoring output wins; the batch continues normally.
- Cached rows now retain metrics/material/classification metadata.
- Keeps the dual-CNN ensemble, material routing, source-colour lock, WebGPU graph capture, cache, deduplication, baker and effects authoring.
