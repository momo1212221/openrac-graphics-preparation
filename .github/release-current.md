Graphics preparation 0.17.1 fixes the OpenRAC launcher store-key failure in long-running AI exports.

- Fixes **"a bad key"** appearing after the duplicate scan and before the AI texture loop.
- The AI resume journal no longer uses a colon in its persistent store key.
- Pack ids are sanitized to OpenRAC's documented `[a-z0-9_-]` key alphabet and the complete key is capped at 64 characters.
- `ModController.storeGet/storeSet` now validate that same launcher contract locally, preventing future invalid keys from reaching the bridge.
- Tests cover colon/dot removal, lowercasing, the 64-character limit and rejection of invalid store keys.
- Persistent IndexedDB AI texture results are separate from the run journal, so cached completed textures remain reusable after the hotfix.
- The one-package native runtime, AI/material pipeline, 90/94/97 quality gates and effects integration from 0.17.0 remain unchanged.
