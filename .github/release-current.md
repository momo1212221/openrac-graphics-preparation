Graphics preparation 0.17.0 unifies the graphics authoring tool and native runtime into one OpenRAC mod.

- One ZIP now contains the tool UI, AI/WASM runtime, models, particle asset and native effects runtime.
- Native libraries are built and merged for Linux x86_64/AArch64, macOS x86_64/ARM64 and Windows x86_64.
- The root mod is now a standard OpenRAC native 1.14 mod with its existing launcher tool page.
- Exported Sparks/Smoke/Mist/Glow/Energy/Rain/Heat Haze packs require graphics-preparation >=0.17.0 instead of a second graphics-effects-runtime install.
- The old Graphics Effects Runtime 0.1.x release remains available only for backwards compatibility with older Graphics preparation versions.
- Placement remains deliberate and validated: real placements.json instance snapping, manual X/Y/Z, migration, orphan cleanup and export blocking for invalid placement.
- Standard/High/Max image-quality gates remain 90/94/97.
