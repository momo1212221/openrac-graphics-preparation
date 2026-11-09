# Graphics Effects Runtime

A normal native OpenRAC mod used by Graphics preparation's particle/effect authoring.

It uses only the official OpenRAC Mod API:

- prop_create / prop_pose / prop_remove for rendered particle meshes;
- haze_set for heat haze;
- loaded_level to select level-authored emitters;
- plugins_folder to read graphics-effects.tsv files from installed authored effect mods.

No launcher fork, service, filesystem bridge or external executable is required.

The companion Graphics preparation page exports a small script/data mod containing
assets/level_NN/object-lights.json and graphics-effects.tsv. Enhanced graphics reads the authored
point/spot lights directly; this runtime reads only the particle/haze rows.

Particles are capped at 192 live props to stay below OpenRAC's shared 256-prop limit.


## 0.1.1

- fixes the 17-field TSV parser used by authored effects;
- rejects unknown presets and malformed level numbers;
- clamps external position/colour values to finite runtime-safe ranges;
- remains compatible with the standard OpenRAC 1.14 mod API and launcher.


## 0.1.2

- removes active particle props explicitly when the loaded level changes;
- clears authored heat haze when leaving gameplay;
- applies each emitter's Gravity value as real per-frame acceleration instead of a one-time velocity offset;
- keeps the 0.1.1 parser/input hardening and all standard OpenRAC 1.14 platform builds.
