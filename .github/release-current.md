Graphics preparation 0.10.4 adds adaptive quality policy.

- Replaces the fixed 45/100 batch threshold with a shared material/class-aware policy.
- Quality Lab shows pass/watch/retry/reject and a recommended action.
- Weak AI outputs retry conservatively without the detail CNN.
- Critically bad uncached neural outputs fall back to deterministic 4x instead of shipping a broken reconstruction.
- Material sidecar metadata now reports the correct generator version.
- Keeps dual-CNN reconstruction, seam-aware context, per-texture overrides and material previews.
