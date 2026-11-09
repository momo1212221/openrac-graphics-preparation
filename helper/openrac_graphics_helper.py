#!/usr/bin/env python3
"""Portable companion for the Graphics preparation OpenRAC mod.

The launcher page stays inside OpenRAC's official sandbox. This helper runs separately, uses
OpenRAC's own editor/assets.py exporter/importer, and emits an ordinary overrides-pack ZIP.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

from geometry_enhance import enhance_export

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


def mesh_job(job: dict, root: Path, levels: Path, output: Path, *, dry_run: bool) -> dict:
    options = job.get("options") if isinstance(job.get("options"), dict) else {}
    mode = str(options.get("profile", "high"))
    if mode not in {"enhanced", "high", "ultra", "experimental"}:
        raise ValueError("mesh profile must be enhanced, high, ultra or experimental")
    scope = str(options.get("scope", "all"))
    if scope not in {"mobys", "scenery", "terrain", "all"}:
        raise ValueError("mesh scope must be mobys, scenery, terrain or all")
    geometry_options = {
        "shape_refine": bool(options.get("shape_refine", False)),
        "allow_collision_mismatch": bool(options.get("allow_collision_mismatch", False)),
    }
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
            report = enhance_export(exported, mode=mode, options=geometry_options)
            report["scope"] = scope
            report["shape_refine"] = geometry_options["shape_refine"]
            report["allow_collision_mismatch"] = geometry_options["allow_collision_mismatch"]
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

    changed = int(report.get("files_changed", 0))
    before = int(report.get("triangles_before", 0))
    after = int(report.get("triangles_after", 0))
    collision_count = len(report.get("collision_rebuild_recommended", []))
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
        },
        "message": (
            f"Dry run valid; planned geometry output is {archive.resolve()}."
            if dry_run
            else f"Enhanced {changed} model files ({before} -> {after} triangles). "
                 f"Collision review recommended for {collision_count} moved primitives. "
                 "Install the generated ZIP through OpenRAC's Mods page."
        ),
    }


def process(job: dict, args: argparse.Namespace) -> dict:
    root = openrac_root(args.openrac_root)
    levels = levels_dir(root, job, args.levels)
    output = Path(args.out or f"graphics-helper-{job['game']}-{job['version']}").expanduser().resolve()
    if job["operation"] == "ai.meshes":
        return mesh_job(job, root, levels, output, dry_run=args.dry_run)
    return texture_job(job, root, levels, output, args.upscaler, dry_run=args.dry_run)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job", type=Path, help="JSON job exported by the Graphics preparation mod page")
    parser.add_argument("--openrac-root", help="OpenRAC checkout/standalone root containing editor/assets.py")
    parser.add_argument("--levels", help="explicit exported levels directory")
    parser.add_argument("--out", help="output directory for the generated pack ZIP")
    parser.add_argument("--upscaler", help="texture upscaler executable (default: realesrgan-ncnn-vulkan in PATH)")
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
