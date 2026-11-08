Graphics preparation 0.6.1 adds exact duplicate elimination before Real-ESRGAN.

- Existing OpenRAC hash-name deduplication remains in place.
- New second-stage duplicate scan checks the actual PNG contents, so identical data with different OpenRAC hashes is still caught.
- Different byte sizes are rejected as duplicates without an extra read.
- Same-size candidates use a fast fingerprint followed by authoritative byte-for-byte comparison.
- Fingerprint collisions therefore cannot merge different textures.
- Each unique source is AI-upscaled once; its 4x result is streamed immediately to every matching OpenRAC output hash.
- No giant all-results cache is kept in RAM.
- The final pack records unique source count, exact duplicate count, unverified scan candidates and actual unique AI run count.
- The UI reports how many expensive Real-ESRGAN passes were avoided.
- Keeps the 0.6 lighting, Enhanced Baker and particle/effects authoring plus the fail-safe AI fallbacks.
