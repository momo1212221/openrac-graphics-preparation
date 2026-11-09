Graphics preparation 0.17.2 fixes native installation from a GitHub release link.

- Publishes the exact OpenRAC native asset names required by the launcher:
  - `graphics-preparation-0.17.2-macos-arm64.zip`
  - `graphics-preparation-0.17.2-macos-x86_64.zip`
  - `graphics-preparation-0.17.2-linux-x86_64.zip`
  - `graphics-preparation-0.17.2-linux-aarch64.zip`
  - `graphics-preparation-0.17.2-windows-x86_64.zip`
- Each platform archive is a complete Graphics preparation install, not only the native runtime library: it includes the launcher tool UI, local ONNX/WASM AI stack, models/material pipeline and only that platform's native library.
- The joined `graphics-preparation-0.17.2.zip` remains available for manual installation.
- `SHA256SUMS` covers the joined archive and every platform archive.
- Release CI refuses publication if any expected platform asset or checksum line is missing.
- Includes the 0.17.1 OpenRAC store-key hotfix for the previous **"a bad key"** failure.
