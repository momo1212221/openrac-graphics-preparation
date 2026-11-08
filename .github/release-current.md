Graphics preparation 0.7.1 adds persistent resume/cache on top of WebGPU and exact duplicate elimination.

- Successful Real-ESRGAN results are cached locally in IndexedDB when the standard OpenRAC WebView supports it.
- SHA-256 source digest + pinned model/pipeline + profile/microdetail/stars options form the cache key.
- A later export or an interrupted/retried run can reuse completed 4x AI results without re-running inference.
- Exact duplicates are still collapsed before cache lookup, so one cache hit can serve multiple OpenRAC hashes.
- Configurable 512 MB / 1 GB / 2 GB / 4 GB cache budget with LRU eviction.
- Quota/IndexedDB/WebCrypto failures are fail-open: caching disables itself and the normal AI export continues.
- Only successful AI output is cached; degraded 4x/original fallbacks are not persisted.
- Adds a Clear persistent AI cache action.
- Keeps Auto WebGPU -> WASM fallback and all 0.6 lighting/baker/effects features.
