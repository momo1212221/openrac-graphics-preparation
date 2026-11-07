#!/usr/bin/env python3
"""Build a deterministic official-OpenRAC mod ZIP and a separately runnable helper script."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
m=json.loads((root/"openrac-mod.json").read_text())
assert set(m["tool"])=={"page"}
assert (root/m["tool"]["page"]).is_file()
files=[root/"openrac-mod.json",root/"LICENSE",root/"README.md"]
for folder in ["ui","src"]:
    files+=sorted(p for p in (root/folder).rglob("*") if p.is_file())
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
helper=out/"openrac-graphics-helper.py"
shutil.copyfile(root/"helper"/"openrac_graphics_helper.py",helper)
helper.chmod(0o755)
artifacts=[archive,helper]
(out/"SHA256SUMS").write_text("".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in artifacts))
print(archive)
print(helper)
