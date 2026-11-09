#!/usr/bin/env python3
"""Portable companion for the Graphics preparation OpenRAC mod.

The launcher page stays inside OpenRAC's official sandbox. This helper runs separately, uses
OpenRAC's own editor/assets.py exporter/importer, and emits an ordinary overrides-pack ZIP.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
from urllib.parse import unquote
import subprocess
import sys
import tempfile
import zipfile

try:
    from .geometry_enhance import derive_height_from_rgba, enhance_export, height_map_from_rgba
except ImportError:  # Direct script execution from the packaged helper folder.
    from geometry_enhance import derive_height_from_rgba, enhance_export, height_map_from_rgba

JOB_KIND = "openrac-graphics-preparation-job"
RESULT_KIND = "openrac-graphics-preparation-result"
SUPPORTED = {"textures.prepare", "ai.textures", "ai.meshes"}


def read_job(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("format") != 1 or value.get("kind") != JOB_KIND:
        raise ValueError("not a Graphics preparation job")
    if value.get("operation") not in SUPPORTED:
        raise ValueError(f"unsupported job operation: {value.get('operation')!r}")
    for key in ("game", "version"):
        if not isinstance(value.get(key), str) or not value[key]:
            raise ValueError(f"job has no {key}")
    return value


def openrac_root(value: str | None) -> Path:
    candidates = [value, os.environ.get("OPENRAC_ROOT"), os.getcwd()]
    for raw in candidates:
        if not raw:
            continue
        root = Path(raw).expanduser().resolve()
        if (root / "editor" / "assets.py").is_file():
            return root
    raise FileNotFoundError("OpenRAC root not found; pass --openrac-root or set OPENRAC_ROOT")


def levels_dir(root: Path, job: dict, explicit: str | None) -> Path:
    if explicit:
        levels = Path(explicit).expanduser().resolve()
    else:
        levels = root / "assets" / "port" / job["game"] / job["version"]
    if not levels.is_dir():
        raise FileNotFoundError(f"OpenRAC levels are not ready: {levels}")
    return levels


def level_numbers(levels: Path) -> list[int]:
    out = []
    for child in levels.iterdir():
        if child.is_dir() and child.name.startswith("level_") and child.name[6:].isdigit() and (child / "manifest.json").is_file():
            out.append(int(child.name[6:]))
    if not out:
        raise FileNotFoundError(f"no exported level_XX folders with manifest.json in {levels}")
    return sorted(set(out))


def run(command: list[str], *, cwd: Path | None = None, dry_run: bool = False) -> None:
    shown = " ".join(json.dumps(part) for part in command)
    print(f"+ {shown}")
    if not dry_run:
        subprocess.run(command, cwd=cwd, check=True)


def find_upscaler(explicit: str | None) -> str:
    requested = explicit or os.environ.get("OPENRAC_TEXTURE_UPSCALER") or "realesrgan-ncnn-vulkan"
    found = shutil.which(requested)
    if found:
        return found
    path = Path(requested).expanduser()
    if path.is_file():
        return str(path.resolve())
    raise FileNotFoundError(
        f"texture upscaler not found: {requested}. Install realesrgan-ncnn-vulkan, pass --upscaler, "
        "or set OPENRAC_TEXTURE_UPSCALER"
    )


def upscale_textures(export_dir: Path, upscaler: str, scale: int, model: str | None, *, dry_run: bool) -> int:
    pictures = sorted(export_dir.rglob("*.png"))
    if not pictures:
        raise FileNotFoundError("OpenRAC exported no PNG textures")
    for picture in pictures:
        target = picture.with_name(picture.stem + ".prepared.png")
        command = [upscaler, "-i", str(picture), "-o", str(target), "-s", str(scale)]
        if model:
            command += ["-n", model]
        run(command, dry_run=dry_run)
        if not dry_run:
            if not target.is_file() or target.stat().st_size == 0:
                raise RuntimeError(f"upscaler did not create {target}")
            target.replace(picture)
    return len(pictures)


def zip_pack(pack: Path, archive: Path) -> None:
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(p for p in pack.rglob("*") if p.is_file()):
            info = zipfile.ZipInfo(path.relative_to(pack).as_posix(), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            zf.writestr(info, path.read_bytes())


def load_openrac_png_reader(root: Path):
    path = root / "editor" / "pngio.py"
    spec = importlib.util.spec_from_file_location("openrac_graphics_pngio", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load OpenRAC PNG reader from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.read


def detect_material_pack(explicit: str | None, job_path: Path) -> Path | None:
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"material pack not found: {path}")
        return path
    candidates = []
    folder = job_path.expanduser().resolve().parent
    for path in sorted(folder.glob("*.zip")):
        try:
            with zipfile.ZipFile(path) as zf:
                names = zf.namelist()
                if any(name.startswith("Materials/") and name.endswith("/height.png") for name in names):
                    candidates.append(path)
        except (OSError, zipfile.BadZipFile):
            continue
    for path in sorted(p for p in folder.iterdir() if p.is_dir()):
        if (path / "Materials").is_dir() and any((path / "Materials").glob("*/height.png")):
            candidates.append(path)
    if len(candidates) == 1:
        print(f"Auto-detected material pack: {candidates[0]}")
        return candidates[0]
    if len(candidates) > 1:
        print("Multiple material packs found beside the job; using diffuse fallback unless --material-pack is passed.")
    return None


class MaterialPackReader:
    def __init__(self, path: Path | None):
        self.path = path
        self.archive = None
        self.hash_to_folder: dict[str, str] = {}
        if path is None:
            return
        if path.is_file():
            self.archive = zipfile.ZipFile(path)
            names = set(self.archive.namelist())
            for name in sorted(n for n in names if n.startswith("Materials/") and n.endswith("/material.json")):
                try:
                    meta = json.loads(self.archive.read(name).decode("utf-8"))
                except Exception:
                    continue
                folder = name.rsplit("/", 1)[0]
                source_hash = str(meta.get("sourceHash") or folder.split("/")[-1]).lower()
                self.hash_to_folder[source_hash] = folder
        elif path.is_dir():
            root = path / "Materials"
            if root.is_dir():
                for meta_path in sorted(root.glob("*/material.json")):
                    try:
                        meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    except Exception:
                        continue
                    source_hash = str(meta.get("sourceHash") or meta_path.parent.name).lower()
                    self.hash_to_folder[source_hash] = f"Materials/{meta_path.parent.name}"
        else:
            raise FileNotFoundError(path)

    def close(self):
        if self.archive is not None:
            self.archive.close()

    def _read(self, relative: str) -> bytes | None:
        if self.path is None:
            return None
        if self.archive is not None:
            try:
                return self.archive.read(relative)
            except KeyError:
                return None
        target = self.path / relative
        return target.read_bytes() if target.is_file() else None

    def sidecar(self, texture_hash: str) -> tuple[bytes, dict] | None:
        key = texture_hash.lower()
        folder = self.hash_to_folder.get(key, f"Materials/{key}")
        height = self._read(folder + "/height.png")
        meta_raw = self._read(folder + "/material.json")
        if height is None or meta_raw is None:
            return None
        try:
            meta = json.loads(meta_raw.decode("utf-8"))
        except Exception:
            return None
        if meta.get("quality", {}).get("ok") is False:
            return None
        return height, meta


def primitive_texture_uri(doc: dict, primitive: dict) -> str | None:
    material_index = primitive.get("material")
    if not isinstance(material_index, int):
        return None
    materials = doc.get("materials") or []
    if not 0 <= material_index < len(materials):
        return None
    pbr = materials[material_index].get("pbrMetallicRoughness") or {}
    base = pbr.get("baseColorTexture") or {}
    texture_index = base.get("index")
    textures = doc.get("textures") or []
    if not isinstance(texture_index, int) or not 0 <= texture_index < len(textures):
        return None
    source = textures[texture_index].get("source")
    images = doc.get("images") or []
    if not isinstance(source, int) or not 0 <= source < len(images):
        return None
    uri = images[source].get("uri")
    return uri if isinstance(uri, str) and not uri.startswith("data:") else None


def material_hint(doc: dict, primitive: dict, kind: str) -> str:
    if kind == "terrain":
        return "terrain"
    index = primitive.get("material")
    name = ""
    if isinstance(index, int) and 0 <= index < len(doc.get("materials") or []):
        name = str(doc["materials"][index].get("name") or "").lower()
    for material, tokens in (
        ("weapon", ("weapon","blaster","gun","wrench","launcher")),
        ("metal", ("metal","steel","iron","chrome","machine")),
        ("stone", ("stone","rock","cliff","brick","concrete")),
        ("fabric", ("fabric","cloth","carpet")),
        ("organic", ("organic","skin","wood","plant")),
        ("energy", ("energy","plasma","glow","emissive")),
        ("glass", ("glass","window")),
    ):
        if any(token in name for token in tokens):
            return material
    return "generic"


class GeometryHeightProvider:
    def __init__(
        self,
        *,
        export_root: Path,
        png_reader,
        material_pack: MaterialPackReader,
        height_source: str = "auto",
    ):
        if height_source not in {"auto", "sidecar", "diffuse"}:
            raise ValueError("height source must be auto, sidecar or diffuse")
        self.export_root = export_root.resolve()
        self.png_reader = png_reader
        self.material_pack = material_pack
        self.height_source = height_source
        self.stats = {"sidecar": 0, "diffuse-derived": 0, "missing": 0, "rejected": 0}

    def __call__(self, gltf_path: Path, doc: dict, primitive: dict, kind: str):
        uri = primitive_texture_uri(doc, primitive)
        if not uri:
            self.stats["missing"] += 1
            return None
        texture_hash = Path(unquote(uri)).stem.lower()
        if self.height_source in {"auto", "sidecar"}:
            found = self.material_pack.sidecar(texture_hash)
            if found is not None:
                height_bytes, meta = found
                try:
                    width, height, rgba = self.png_reader(height_bytes)
                    pipeline = meta.get("heightPipeline") or {}
                    parallax = pipeline.get("parallaxAuthoring") or {}
                    material = str(meta.get("material") or material_hint(doc, primitive, kind))
                    result = height_map_from_rgba(
                        width, height, rgba,
                        material=material,
                        neutral=float(parallax.get("neutralHeight", 0.5)),
                        recommended_scale=parallax.get("recommendedScale"),
                        source="sidecar",
                    )
                    self.stats["sidecar"] += 1
                    return result
                except Exception:
                    self.stats["rejected"] += 1
                    if self.height_source == "sidecar":
                        return None
            elif self.height_source == "sidecar":
                self.stats["missing"] += 1
                return None

        # Auto/diffuse fallback uses the exact exported material image referenced by this glTF.
        relative = unquote(uri)
        if relative.startswith(("/", "\\")) or ":" in relative.split("/")[0]:
            self.stats["rejected"] += 1
            return None
        image_path = (gltf_path.parent / relative).resolve()
        if self.export_root not in image_path.parents:
            self.stats["rejected"] += 1
            return None
        if not image_path.is_file():
            self.stats["missing"] += 1
            return None
        try:
            width, height, rgba = self.png_reader(image_path.read_bytes())
            result = derive_height_from_rgba(
                width, height, rgba, material_hint(doc, primitive, kind)
            )
            self.stats["diffuse-derived"] += 1
            return result
        except Exception:
            self.stats["rejected"] += 1
            return None


def texture_job(job: dict, root: Path, levels: Path, output: Path, upscaler: str | None, *, dry_run: bool) -> dict:
    options = job.get("options") if isinstance(job.get("options"), dict) else {}
    scale = int(options.get("scale", 4 if job["operation"] == "textures.prepare" else 2))
    if scale not in (2, 3, 4):
        raise ValueError("texture scale must be 2, 3 or 4")
    model = options.get("model") if isinstance(options.get("model"), str) else None
    tool = find_upscaler(upscaler) if not dry_run else (upscaler or os.environ.get("OPENRAC_TEXTURE_UPSCALER") or "realesrgan-ncnn-vulkan")
    levels_to_export = level_numbers(levels)
    output.mkdir(parents=True, exist_ok=True)
    pack = output / "pack"
    archive = output / f"graphics-{job['game']}-{job['version']}-{job['operation'].replace('.', '-')}.zip"
    with tempfile.TemporaryDirectory(prefix="openrac-graphics-") as scratch_name:
        scratch = Path(scratch_name)
        exported = scratch / "export"
        export_cmd = [sys.executable, str(root / "editor" / "assets.py"), "export", str(levels), str(exported), "--what", "textures"]
        for level in levels_to_export:
            export_cmd += ["--level", str(level)]
        run(export_cmd, cwd=root, dry_run=dry_run)
        count = 0 if dry_run else upscale_textures(exported, tool, scale, model, dry_run=False)
        if dry_run:
            print(f"Would upscale exported PNG files with {tool}, scale {scale}, model {model or 'default'}")
        import_cmd = [
            sys.executable,
            str(root / "editor" / "assets.py"),
            "import",
            str(exported),
            "--levels",
            str(levels),
            "--out",
            str(pack),
            "--name",
            "Graphics preparation",
            "--author",
            "OpenRAC graphics helper",
            "--description",
            f"Prepared textures for {job['game']} {job['version']}",
        ]
        run(import_cmd, cwd=root, dry_run=dry_run)
        if not dry_run:
            zip_pack(pack, archive)
    return {
        "format": 1,
        "kind": RESULT_KIND,
        "operation": job["operation"],
        "ok": True,
        "output": str(archive.resolve()),
        "message": (
            f"Dry run valid; planned output is {archive.resolve()}."
            if dry_run
            else f"Prepared {count} texture files. Install the generated ZIP through OpenRAC's Mods page."
        ),
    }


def mesh_job(
    job: dict,
    root: Path,
    levels: Path,
    output: Path,
    *,
    dry_run: bool,
    material_pack_path: Path | None = None,
) -> dict:
    options = job.get("options") if isinstance(job.get("options"), dict) else {}
    mode = str(options.get("profile", "high"))
    if mode not in {"enhanced", "high", "ultra", "modern", "experimental"}:
        raise ValueError("mesh profile must be enhanced, high, ultra, modern or experimental")
    scope = str(options.get("scope", "all"))
    if scope not in {"mobys", "scenery", "terrain", "all"}:
        raise ValueError("mesh scope must be mobys, scenery, terrain or all")
    geometry_options = {
        "shape_refine": bool(options.get("shape_refine", False)),
        "allow_collision_mismatch": bool(options.get("allow_collision_mismatch", False)),
        "adaptive_subdivision": options.get("adaptive_subdivision", True) is not False,
        "micro_displacement": options.get("micro_displacement", False) is True,
        "displacement_strength": max(0.0, min(1.5, float(options.get("displacement_strength", 1.0)))),
    }
    height_source = str(options.get("height_source", "auto"))
    if height_source not in {"auto", "sidecar", "diffuse"}:
        raise ValueError("height_source must be auto, sidecar or diffuse")
    if isinstance(options.get("crease_angle_degrees"), (int, float)):
        geometry_options["crease_angle_degrees"] = float(options["crease_angle_degrees"])
    if isinstance(options.get("triangle_budget"), (int, float)):
        geometry_options["triangle_budget"] = int(options["triangle_budget"])

    levels_to_export = level_numbers(levels)
    output.mkdir(parents=True, exist_ok=True)
    pack = output / "pack"
    archive = output / f"graphics-{job['game']}-{job['version']}-geometry-{mode}.zip"
    report_path = output / "geometry-report.json"

    with tempfile.TemporaryDirectory(prefix="openrac-geometry-") as scratch_name:
        scratch = Path(scratch_name)
        exported = scratch / "export"
        export_cmd = [
            sys.executable, str(root / "editor" / "assets.py"), "export",
            str(levels), str(exported), "--what", scope,
        ]
        for level in levels_to_export:
            export_cmd += ["--level", str(level)]
        run(export_cmd, cwd=root, dry_run=dry_run)

        pack_reader = MaterialPackReader(material_pack_path)
        height_provider = None
        height_stats = {"sidecar": 0, "diffuse-derived": 0, "missing": 0, "rejected": 0}
        if geometry_options["micro_displacement"] and not dry_run:
            png_reader = load_openrac_png_reader(root)
            height_provider = GeometryHeightProvider(
                export_root=exported,
                png_reader=png_reader,
                material_pack=pack_reader,
                height_source=height_source,
            )

        if dry_run:
            report = {
                "format": 1,
                "mode": mode,
                "scope": scope,
                "dry_run": True,
                "files_seen": 0,
                "files_changed": 0,
                "triangles_before": 0,
                "triangles_after": 0,
                "collision_rebuild_recommended": [],
            }
        else:
            report = enhance_export(
                exported, mode=mode, options=geometry_options, height_provider=height_provider
            )
            if height_provider is not None:
                height_stats = dict(height_provider.stats)
            report["scope"] = scope
            report["shape_refine"] = geometry_options["shape_refine"]
            report["allow_collision_mismatch"] = geometry_options["allow_collision_mismatch"]
            report["adaptive_subdivision"] = geometry_options["adaptive_subdivision"]
            report["crease_angle_degrees"] = geometry_options.get("crease_angle_degrees")
            report["micro_displacement"] = geometry_options["micro_displacement"]
            report["displacement_strength"] = geometry_options["displacement_strength"]
            report["height_source"] = height_source
            report["height_source_stats"] = height_stats
            report["material_pack"] = str(material_pack_path) if material_pack_path else None
            if report["files_changed"] <= 0:
                raise RuntimeError("no compatible OpenRAC glTF meshes were enhanced")

        import_cmd = [
            sys.executable,
            str(root / "editor" / "assets.py"),
            "import",
            str(exported),
            "--levels",
            str(levels),
            "--out",
            str(pack),
            "--name",
            "Graphics preparation · Geometry",
            "--author",
            "OpenRAC graphics helper",
            "--description",
            f"Geometry enhancement {mode} for {job['game']} {job['version']}",
        ]
        run(import_cmd, cwd=root, dry_run=dry_run)
        if not dry_run:
            report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            zip_pack(pack, archive)
        pack_reader.close()

    changed = int(report.get("files_changed", 0))
    before = int(report.get("triangles_before", 0))
    after = int(report.get("triangles_after", 0))
    collision_count = len(report.get("collision_rebuild_recommended", []))
    adaptive_edges = int(report.get("adaptive_edges_split", 0))
    crease_splits = int(report.get("crease_vertices_split", 0))
    budget_limited = int(report.get("budget_limited_primitives", 0))
    skipped_primitives = int(report.get("primitives_skipped", 0))
    displacement_primitives = int(report.get("micro_displacement_primitives", 0))
    displacement_sources = report.get("micro_displacement_sources", {})
    return {
        "format": 1,
        "kind": RESULT_KIND,
        "operation": job["operation"],
        "ok": True,
        "output": str(archive.resolve()),
        "report": str(report_path.resolve()),
        "geometry": {
            "profile": mode,
            "scope": scope,
            "files_changed": changed,
            "triangles_before": before,
            "triangles_after": after,
            "collision_rebuild_recommended": collision_count,
            "adaptive_edges_split": adaptive_edges,
            "crease_vertices_split": crease_splits,
            "budget_limited_primitives": budget_limited,
            "primitives_skipped": skipped_primitives,
            "micro_displacement_primitives": displacement_primitives,
            "micro_displacement_sources": displacement_sources,
            "height_source_stats": report.get("height_source_stats", {}),
        },
        "message": (
            f"Dry run valid; planned geometry output is {archive.resolve()}."
            if dry_run
            else f"Enhanced {changed} model files ({before} -> {after} triangles). "
                 f"Adaptive edges: {adaptive_edges}; preserved crease splits: {crease_splits}; "
                 f"budget-limited primitives: {budget_limited}; skipped unsupported primitives: {skipped_primitives}; "
                 f"micro-displaced primitives: {displacement_primitives} ({displacement_sources}). "
                 f"Collision review recommended for {collision_count} moved primitives. "
                 "Install the generated ZIP through OpenRAC's Mods page."
        ),
    }


def process(job: dict, args: argparse.Namespace) -> dict:
    root = openrac_root(args.openrac_root)
    levels = levels_dir(root, job, args.levels)
    output = Path(args.out or f"graphics-helper-{job['game']}-{job['version']}").expanduser().resolve()
    if job["operation"] == "ai.meshes":
        material_pack = detect_material_pack(args.material_pack, args.job)
        return mesh_job(
            job, root, levels, output,
            dry_run=args.dry_run,
            material_pack_path=material_pack,
        )
    return texture_job(job, root, levels, output, args.upscaler, dry_run=args.dry_run)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path, help="JSON job exported by the Graphics preparation mod page")
    parser.add_argument("--openrac-root", help="OpenRAC checkout/standalone root containing editor/assets.py")
    parser.add_argument("--levels", help="explicit exported levels directory")
    parser.add_argument("--out", help="output directory for the generated pack ZIP")
    parser.add_argument("--upscaler", help="texture upscaler executable (default: realesrgan-ncnn-vulkan in PATH)")
    parser.add_argument(
        "--material-pack",
        help="Graphics preparation texture/material pack ZIP or unpacked directory; auto-detected beside the geometry job when unique",
    )
    parser.add_argument("--result-json", type=Path, help="also write a result JSON that the mod page can open")
    parser.add_argument("--dry-run", action="store_true", help="validate and print the plan without running tools")
    args = parser.parse_args(argv)
    operation = "unknown"
    try:
        job = read_job(args.job)
        operation = job["operation"]
        result = process(job, args)
    except Exception as exc:  # CLI boundary: always leave a machine-readable result.
        result = {"format": 1, "kind": RESULT_KIND, "operation": operation, "ok": False, "message": str(exc)}
    text = json.dumps(result, indent=2) + "\n"
    print(text, end="")
    if args.result_json:
        args.result_json.parent.mkdir(parents=True, exist_ok=True)
        args.result_json.write_text(text, encoding="utf-8")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
