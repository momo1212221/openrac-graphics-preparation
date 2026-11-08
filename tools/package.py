#!/usr/bin/env python3
"""Build a deterministic installable OpenRAC mod ZIP."""
import hashlib
import json
import os
import zipfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
m=json.loads((root/"openrac-mod.json").read_text())
assert set(m["tool"])=={"page"}
assert (root/m["tool"]["page"]).is_file()
scripts=[root/p for p in m.get("scripts",[])]
assert scripts and all(p.is_file() for p in scripts)
if os.environ.get("OPENRAC_REQUIRE_AI_ASSETS")=="1":
    for path in [
        root/"vendor"/"ort.wasm.bundle.min.mjs",
        root/"vendor"/"ort-wasm-simd-threaded.wasm",
        root/"vendor"/"ort.webgpu.bundle.min.mjs",
        root/"vendor"/"ort-wasm-simd-threaded.asyncify.wasm",
        root/"models"/"realesrgan-x4plus.onnx",
    ]:
        assert path.is_file(), f"missing AI release asset: {path}"
files=[root/"openrac-mod.json",root/"LICENSE",root/"README.md",*scripts]
for folder in ["ui","src","vendor","models"]:
    directory=root/folder
    if directory.is_dir():
        files+=sorted(p for p in directory.rglob("*") if p.is_file())
out=root/"dist"
out.mkdir(exist_ok=True)
archive=out/(m["id"]+"-"+m["version"]+".zip")
with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:
    for p in files:
        assert not p.is_symlink()
        info=zipfile.ZipInfo(m["id"]+"/"+p.relative_to(root).as_posix(),(2026,1,1,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o100644<<16
        z.writestr(info,p.read_bytes())
(out/"SHA256SUMS").write_text(f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n")
print(archive)
