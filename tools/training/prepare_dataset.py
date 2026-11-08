#!/usr/bin/env python3
"""Build deterministic synthetic PS2-style training pairs from user-owned high-resolution assets."""
from __future__ import annotations

import argparse
import hashlib
import json
import random
from collections import Counter
from pathlib import Path

from PIL import Image, ImageFilter

MATERIALS = {
    "weapon": ("weapon","wrench","blaster","gun","launcher","cannon","rifle"),
    "character": ("ratchet","clank","character","hero","npc","enemy","boss","skin"),
    "terrain": ("terrain","ground","floor","sand","dirt","grass","soil"),
    "stone": ("rock","stone","cliff","cave","concrete","brick"),
    "metal": ("metal","steel","iron","chrome","machine","robot","ship","vehicle","panel"),
    "fabric": ("cloth","fabric","carpet","banner","flag"),
    "glass": ("glass","window","crystal","lens"),
    "organic": ("flesh","wood","tree","plant","organic"),
    "energy": ("energy","plasma","electric","glow","emissive","laser","forcefield"),
    "sky": ("sky","skybox","cloud","background"),
}
EXT={".png",".jpg",".jpeg",".webp"}

def material(path: Path) -> str:
    p=str(path).lower()
    for name,words in MATERIALS.items():
        if any(w in p for w in words):
            return name
    return "generic"

def split_for(key: str) -> str:
    """Stable 90/5/5 split. Call with source content SHA to prevent duplicate leakage."""
    n=int(hashlib.sha256(key.encode()).hexdigest()[:8],16)%100
    return "train" if n<90 else ("validation" if n<95 else "test")

def degrade(image: Image.Image, seed: int) -> Image.Image:
    rng=random.Random(seed)
    w,h=image.size
    scale=rng.choice((2,2,2,4))
    small=image.resize((max(1,w//scale),max(1,h//scale)),Image.Resampling.BILINEAR)
    if rng.random()<.65:
        small=small.filter(ImageFilter.GaussianBlur(rng.uniform(.15,.65)))
    colours=rng.choice((32,64,128,256))
    alpha=small.getchannel("A")
    rgb=small.convert("RGB").quantize(colors=colours,method=Image.Quantize.MEDIANCUT).convert("RGB")
    low=Image.merge("RGBA",(*rgb.split(),alpha))
    return low.resize((w,h),Image.Resampling.BILINEAR)

def patch_coordinates(width:int,height:int,patch:int,stride:int,max_per_image:int,seed:int):
    coords=[
        (x,y)
        for y in range(0,height-patch+1,stride)
        for x in range(0,width-patch+1,stride)
    ]
    if max_per_image>0 and len(coords)>max_per_image:
        rng=random.Random(seed)
        rng.shuffle(coords)
        coords=coords[:max_per_image]
        coords.sort(key=lambda p:(p[1],p[0]))
    return coords

def main() -> None:
    ap=argparse.ArgumentParser()
    ap.add_argument("source",type=Path,help="Directory of user-owned/licensed high-resolution reference assets")
    ap.add_argument("output",type=Path)
    ap.add_argument("--patch",type=int,default=128)
    ap.add_argument("--stride",type=int,default=96)
    ap.add_argument("--max-per-image",type=int,default=256)
    ap.add_argument(
        "--keep-duplicate-sources",
        action="store_true",
        help="Keep exact duplicate source images. By default duplicates are skipped to prevent train/validation leakage and source over-weighting.",
    )
    args=ap.parse_args()
    if args.patch<=0 or args.stride<=0:
        raise SystemExit("--patch and --stride must be positive")
    if not args.source.is_dir():
        raise SystemExit(f"source directory does not exist: {args.source}")

    args.output.mkdir(parents=True,exist_ok=True)
    manifest_path=args.output/"manifest.jsonl"
    split_counts=Counter()
    material_counts=Counter()
    split_material_counts=Counter()
    source_count=0
    duplicate_sources=0
    skipped_small=0
    skipped_unreadable=0
    pair_count=0
    seen_source_sha=set()

    with manifest_path.open("w",encoding="utf-8") as manifest:
        for path in sorted(p for p in args.source.rglob("*") if p.suffix.lower() in EXT):
            try:
                raw=path.read_bytes()
                source_sha=hashlib.sha256(raw).hexdigest()
                if source_sha in seen_source_sha and not args.keep_duplicate_sources:
                    duplicate_sources+=1
                    continue
                with Image.open(path) as opened:
                    im=opened.convert("RGBA")
            except Exception:
                skipped_unreadable+=1
                continue

            if im.width<args.patch or im.height<args.patch:
                skipped_small+=1
                continue

            seen_source_sha.add(source_sha)
            source_count+=1
            rel=path.relative_to(args.source).as_posix()
            mat=material(path)
            split=split_for(source_sha)
            seed=int(source_sha[:16],16)
            coords=patch_coordinates(im.width,im.height,args.patch,args.stride,args.max_per_image,seed)

            for x,y in coords:
                target=im.crop((x,y,x+args.patch,y+args.patch))
                digest=hashlib.sha256((source_sha+f":{x}:{y}:{args.patch}").encode()).hexdigest()
                low=degrade(target,int(digest[:16],16))
                folder=args.output/split/mat
                folder.mkdir(parents=True,exist_ok=True)
                stem=digest[:24]
                input_path=folder/f"{stem}-input.png"
                target_path=folder/f"{stem}-target.png"
                low.save(input_path,optimize=True)
                target.save(target_path,optimize=True)
                row={
                    "id":stem,
                    "source":rel,
                    "material":mat,
                    "split":split,
                    "input":input_path.relative_to(args.output).as_posix(),
                    "target":target_path.relative_to(args.output).as_posix(),
                    "patch":[x,y,args.patch,args.patch],
                    "source_sha256":source_sha,
                }
                manifest.write(json.dumps(row,separators=(",",":"))+"\n")
                pair_count+=1
                split_counts[split]+=1
                material_counts[mat]+=1
                split_material_counts[f"{split}:{mat}"]+=1

    summary={
        "version":2,
        "pairs":pair_count,
        "unique_sources":source_count,
        "duplicate_sources_skipped":duplicate_sources,
        "small_sources_skipped":skipped_small,
        "unreadable_sources_skipped":skipped_unreadable,
        "patch":args.patch,
        "stride":args.stride,
        "max_per_image":args.max_per_image,
        "split_policy":"source-content-sha256-90-5-5",
        "split_counts":dict(sorted(split_counts.items())),
        "material_counts":dict(sorted(material_counts.items())),
        "split_material_counts":dict(sorted(split_material_counts.items())),
        "manifest_sha256":hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
    }
    summary_path=args.output/"dataset-summary.json"
    summary_path.write_text(json.dumps(summary,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print(json.dumps({**summary,"manifest":str(manifest_path),"summary":str(summary_path)},indent=2))

if __name__=="__main__":
    main()
