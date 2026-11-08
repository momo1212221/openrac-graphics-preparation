Graphics preparation 0.2.1 fixes installation on OpenRAC Launcher 1.0.2.

- Adds a no-op Luau compatibility entry point so Launcher 1.0.2 no longer treats the package as an unbuilt native mod.
- Keeps the documented `tool.page` UI for newer launcher builds that support mod-owned pages.
- The compatibility script has no gameplay hooks and no gameplay side effects.
- Enhanced lighting/GI, probe baking, water and reflections continue to use OpenRAC's built-in path.
- Ultra/AI texture preparation still uses the separately started helper.
- AI mesh preparation is not implemented yet.

Install **`graphics-preparation-0.2.1.zip` from this release** through **Mods -> Add mod -> ZIP**.
Do not install GitHub's source archive `openrac-graphics-preparation-main.zip`.

On Launcher 1.0.2 the custom mod page is not available yet; use `openrac-graphics-helper.py`
externally for Ultra/AI jobs.
