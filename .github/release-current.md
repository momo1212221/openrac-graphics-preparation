Graphics preparation 0.3.0 integrates texture preparation into the OpenRAC mod page.

- UI redesigned to follow the Enhanced graphics settings layout.
- Reads OpenRAC's own saved texture assets directly through the mod-tool API.
- Local 2x and 4x texture preparation runs inside the sandboxed mod page.
- Edge-preserving or high-quality smooth scaling.
- Streams a standard OpenRAC texture-pack ZIP to disk.
- No Python helper is required for the normal texture-upscale workflow.
- Lighting/GI and temporal upscaling stay in OpenRAC's built-in Enhanced graphics page.

Use OpenRAC's **Models and textures -> Save the game's textures while you play** first, then open
**Graphics preparation**, choose the quality and press **Prepare textures**.
