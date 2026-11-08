Graphics preparation 0.6.0 adds lighting, Enhanced Baker authoring and particle/effect authoring to the same standard-launcher page.

- Keeps the fail-safe Real-ESRGAN pipeline from 0.5.3.
- Reads exported OpenRAC levels and builds an object selector from their manifests.
- Point and spot lights export as the official Enhanced renderer object-lights.json format.
- Supports object/bone-local position, colour, intensity, range and spot cone/direction.
- Adds bake-only rectangular area lights using probe-bake.json area_lights.
- Exposes sky intensity/weight, surface emission gain, environment-probe resolution/count/spacing.
- Preserves existing probe-bake.json fields while applying authored changes.
- Particle presets: sparks, smoke, mist, glow, energy, rain and heat haze.
- Exports a normal OpenRAC runtime-effects mod for point/spot lights and particle configuration.
- The companion graphics-effects-runtime native mod uses only the official OpenRAC mod SDK; no custom launcher is required.
- The stock Mod Tool API still cannot overwrite extracted level files or press Prepare lighting, so bake profiles are saved for the built-in Enhanced graphics -> Prepare lighting workflow.
