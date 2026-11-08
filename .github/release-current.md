Graphics preparation 0.5.3 makes the stock-launcher AI pipeline fail-safe.

- Keeps the fixed 128x128 Real-ESRGAN inputs from 0.5.2.
- Runs an actual 128x128 -> 512x512 model preflight before the output pack is opened.
- Retries failed OpenRAC asset reads once.
- On an ONNX inference failure, releases/rebuilds the AI session and retries that texture once.
- If AI still fails, only that texture falls back to deterministic edge-preserving 4x scaling.
- If 4x scaling also fails, the original PNG is preserved in the pack.
- Unreadable source textures are skipped and counted rather than killing the run.
- The final pack manifest records requested/included/AI/retry/fallback/original/unreadable counts.
- ZIP/disk output errors still stop safely and cancel the incomplete save, because continuing after an uncertain append could corrupt the archive.
- Still uses the standard OpenRAC Dev Launcher only: no custom launcher, Python helper or external app.
