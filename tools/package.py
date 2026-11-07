#!/usr/bin/env python3
"""Build an installable mod ZIP containing source/UI only; never include game or save data."""
import hashlib,json,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
m=json.loads((root/"openrac-mod.json").read_text())
assert m["tool"]["service"]==m["id"]
assert (root/m["tool"]["page"]).is_file()
files=[root/"openrac-mod.json",root/"LICENSE",root/"README.md"]
for folder in ["ui","src"]:files+=sorted(p for p in (root/folder).rglob("*") if p.is_file())
out=root/"dist";out.mkdir(exist_ok=True)
archive=out/(m["id"]+"-"+m["version"]+".zip")
with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:
 for p in files:
  assert not p.is_symlink()
  info=zipfile.ZipInfo(m["id"]+"/"+p.relative_to(root).as_posix(),(2026,1,1,0,0,0))
  info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
  z.writestr(info,p.read_bytes())
sha=hashlib.sha256(archive.read_bytes()).hexdigest()
(out/"SHA256SUMS").write_text(sha+"  "+archive.name+"\n")
print(archive)
