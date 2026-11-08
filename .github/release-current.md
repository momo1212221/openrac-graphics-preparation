Graphics preparation 0.4.0 ports the native AI graphics path from the OpenRAC fork into the installed mod UI.

- Declares the bounded `graphics-preparation` launcher service used by the fork.
- **Prepare AI graphics** runs the fork's Upscayl/NCNN texture backend.
- Faithful, Balanced and Maximum Detail profiles.
- Preserves original micro-detail, stars and tiny lights after the neural pass.
- Optional 3D AI for render meshes; collision always stays original.
- Uses staging/backups from the fork backend, so a failed pass does not replace the current prepared pack.
- Same Enhanced-graphics-style UI.
- Supports RAC1-RAC4 versions represented by the fork service.
- Stock launchers keep the local 2x/4x export fallback.

On macOS install Upscayl in /Applications for the native AI path. No Python helper is required.
