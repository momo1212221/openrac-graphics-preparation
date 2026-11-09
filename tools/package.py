#!/usr/bin/env python3
"""Build a deterministic installable OpenRAC mod ZIP.

For production releases OPENRAC_NATIVE_PACKAGE points at a merged package_mod.py
folder containing the native libraries for all supported platforms. The source
manifest intentionally carries no plugin table; the final archive receives the
verified merged plugin table here.
"""
import hashlib
import json
import os
import zipfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
PINNED_BASE_X4PLUS_SHA256="a64fb7ec8780e6e67a99cf380067961a0aab618c934171240eea2724217fd304"

m=json.loads((root/"openrac-mod.json").read_text())
assert set(m["tool"])=={"page","service"}
assert m["tool"]["service"]=="graphics-preparation"
assert (root/m["tool"]["page"]).is_file()
assert m.get("type")=="native"
assert m.get("api")=="1.14"
assert not m.get("scripts"), "unified native product must not declare Luau scripts"

native_root_env=os.environ.get("OPENRAC_NATIVE_PACKAGE","").strip()
native_root=Path(native_root_env).resolve() if native_root_env else None
native_files=[]
if native_root:
    native_manifest_path=native_root/"openrac-mod.json"
    assert native_manifest_path.is_file(), f"missing merged native manifest: {native_manifest_path}"
    native_manifest=json.loads(native_manifest_path.read_text())
    assert native_manifest.get("id")==m.get("id")
    assert native_manifest.get("version")==m.get("version")
    plugins=native_manifest.get("plugin")
    assert isinstance(plugins,dict) and plugins, "merged native package has no plugin table"
    required={"linux-x86_64","linux-aarch64","macos-arm64","macos-x86_64","windows-x86_64"}
    if os.environ.get("OPENRAC_REQUIRE_NATIVE")=="1":
        missing=required-set(plugins)
        assert not missing, f"missing native platforms: {sorted(missing)}"
    for platform,path in plugins.items():
        p=native_root/path
        assert p.is_file(), f"missing native library for {platform}: {p}"
        native_files.append((path,p))
    m["plugin"]=plugins
else:
    if os.environ.get("OPENRAC_REQUIRE_NATIVE")=="1":
        raise AssertionError("OPENRAC_NATIVE_PACKAGE is required for a production release")
    # Unit/package determinism tests may build a tool-only preview. It is never
    # published because release CI sets OPENRAC_REQUIRE_NATIVE=1.
    m.pop("plugin",None)

if os.environ.get("OPENRAC_REQUIRE_AI_ASSETS")=="1":
    for path in [
        root/"vendor"/"ort.wasm.bundle.min.mjs",
        root/"vendor"/"ort-wasm-simd-threaded.wasm",
        root/"vendor"/"ort.webgpu.bundle.min.mjs",
        root/"vendor"/"ort-wasm-simd-threaded.asyncify.wasm",
        root/"models"/"realesrgan-x4plus.onnx",
        root/"models"/"realesrgan-general-x4v3.onnx",
    ]:
        assert path.is_file(), f"missing AI release asset: {path}"

specialized_manifest=root/"models"/"specialized-models.json"
specialized=list((root/"models").glob("detail-*.onnx")) if (root/"models").is_dir() else []
if specialized:
    assert specialized_manifest.is_file(), "specialized models require models/specialized-models.json"
    registry=json.loads(specialized_manifest.read_text())
    assert registry.get("version")==1 and isinstance(registry.get("models"),dict)
    registered={entry["file"]:entry for entry in registry["models"].values()}
    for model in specialized:
        assert model.name in registered, f"unregistered specialized model: {model.name}"
        entry=registered[model.name]
        digest=hashlib.sha256(model.read_bytes()).hexdigest()
        assert digest==entry.get("sha256"), f"specialized model hash mismatch: {model.name}"
        validation=root/"models"/entry.get("validation","")
        assert validation.is_file(), f"missing validation report: {model.name}"
        report=json.loads(validation.read_text())
        assert report.get("release_candidate") is True
        assert report.get("model_sha256")==digest
        assert int(report.get("version",0))>=3
        assert report.get("dataset_input_pipeline")=="base-cnn-reconstruction"
        assert report.get("base_model_sha256")==PINNED_BASE_X4PLUS_SHA256
        assert float(report.get("laplacian_improvement",0))>0

entries=[]
def add_file(arcname,path):
    assert path.is_file() and not path.is_symlink()
    entries.append((arcname,path.read_bytes()))

add_file("LICENSE",root/"LICENSE")
add_file("README.md",root/"README.md")
add_file("GUIDE.md",root/"GUIDE.md")
add_file("helper/openrac_graphics_helper.py",root/"helper"/"openrac_graphics_helper.py")
add_file("helper/geometry_enhance.py",root/"helper"/"geometry_enhance.py")
for folder in ["ui","src","vendor","models"]:
    directory=root/folder
    if directory.is_dir():
        for p in sorted(x for x in directory.rglob("*") if x.is_file()):
            add_file(p.relative_to(root).as_posix(),p)

# Runtime prop used by the integrated native library.
add_file("assets/particle.glb",root/"effects-runtime/assets/particle.glb")
for arcname,path in sorted(native_files):
    add_file(arcname,path)

out=root/"dist"
out.mkdir(exist_ok=True)

def write_archive(path,manifest,archive_entries):
    with zipfile.ZipFile(path,"w",zipfile.ZIP_DEFLATED) as z:
        manifest_bytes=(json.dumps(manifest,indent=2)+"\n").encode()
        all_entries=[("openrac-mod.json",manifest_bytes),*archive_entries]
        seen=set()
        for rel,data in all_entries:
            assert rel not in seen, f"duplicate archive entry: {rel}"
            seen.add(rel)
            info=zipfile.ZipInfo(m["id"]+"/"+rel,(2026,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o100644<<16
            z.writestr(info,data)

archives=[]
archive=out/(m["id"]+"-"+m["version"]+".zip")
write_archive(archive,m,entries)
archives.append(archive)

# OpenRAC's launcher installs native mods from a platform-specific release asset:
# <id>-<version>-<platform>.zip. Build those from the same one-product content,
# but keep only the selected platform's native library and manifest entry.
if native_root:
    native_paths={path for path,_ in native_files}
    common_entries=[entry for entry in entries if entry[0] not in native_paths]
    for platform,path in sorted(m["plugin"].items()):
        selected=[entry for entry in entries if entry[0]==path]
        assert len(selected)==1, f"missing selected native library for {platform}: {path}"
        platform_manifest=dict(m)
        platform_manifest["plugin"]={platform:path}
        platform_archive=out/f'{m["id"]}-{m["version"]}-{platform}.zip'
        write_archive(platform_archive,platform_manifest,[*common_entries,*selected])
        archives.append(platform_archive)

sums="".join(
    f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
    for path in sorted(archives,key=lambda p:p.name)
)
(out/"SHA256SUMS").write_text(sums)
for path in archives:
    print(path)
