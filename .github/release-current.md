Graphics preparation 0.15.0 productionizes runtime effect placement while retaining the 0.14 realism/AI pipeline.

- Runtime Sparks, Smoke, Mist, Glow, Energy, Rain and Heat Haze can be placed at explicit world X/Y/Z coordinates.
- Level-instance snapping reads the official OpenRAC `placements.json` matrices for ties, shrubs and mobys instead of guessing positions from class metadata.
- Light-class selection and particle-instance placement are separate, preventing one authoring control from overwriting the other.
- Legacy saved effects preserve their coordinates but require one explicit placement confirmation after migration.
- Export is blocked for unplaced effects, unavailable levels or malformed coordinates; no silent origin placement or dropped rows.
- Placement anchors are snapshots in world space and are labelled as such; moving gameplay objects are not falsely presented as live attachments.
- Graphics Effects Runtime 0.1.1 fixes the 17-field TSV parser, rejects unknown presets/malformed levels and bounds external coordinate/colour input.
- Standard/High/Max texture quality remains 90/94/97 with the 0.14 alpha, regional CNN confidence, PBR and material-sidecar improvements intact.
