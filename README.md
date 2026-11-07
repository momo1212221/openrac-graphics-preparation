# Graphics preparation

An independently installed OpenRAC launcher mod, maintained and released from this repository.

## Install

Requires the **momo1212221/OpenRAC fork launcher 1.0.5 or newer**, with the launcher-service bridge. It does not run on unmodified official launchers: their tool pages deliberately cannot run the baker or write saves.

Download `graphics-preparation-0.1.0.zip` from this repository's Releases. In the launcher choose **Mods → Add mod → ZIP**, then open **Graphics preparation**. The launcher asks for the specific service permission before showing the page. Enable the feature inside the mod. Remove it from the normal mod page to uninstall; existing caches and save archives stay intact. Uninstalling disables automatic work.

## Graphics

The mod owns preparation controls, settings and job orchestration for lighting/GI, water/cloud baking, Ultra textures and AI assets. It can prepare while Enhanced graphics is off. Enable Enhanced graphics as well to render prepared lighting and clouds; Metal sunlight uses the native port bridge. The game renderer remains Vulkan/MoltenVK, not a separate replacement Metal renderer. Baker binaries and native rendering code come from the compatible fork launcher, not from a copied disc or this ZIP. AI preparation needs the supported local AI backend.

## Develop

`node --test` runs dependency-free controller tests. `python3 tools/package.py` creates a deterministic installable ZIP and SHA256SUMS. The UI is sandboxed and uses the documented `service` message with a fixed operation allowlist. No terminal command or arbitrary filesystem path is accepted. This repository contains no game, disc, model weights or save data.

GPL-3.0-or-later. Derived from the user's OpenRAC fork; underlying host services remain in that GPL project.
