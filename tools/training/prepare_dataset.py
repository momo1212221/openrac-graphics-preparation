#!/usr/bin/env python3
"""Build deterministic synthetic PS2-style training pairs from user-owned high-resolution assets."""
from __future__ import annotations
import argparse, hashlib, json, random
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
        if any(w in p for w in words): return name
    return "generic"

def split_for(key: str) -> str:
    n=int(hashlib.sha256(key.encode()).hexdigest()[:8],16)%100
    return "train" if n<90 else ("validation" if n<95 else "test")

def degrade(image: Image.Image, seed: int) -> Image.Image:
    rng=random.Random(seed)
    w,h=image.size
    scale=rng.choice((2,2,2,4))
    small=image.resize((max(1,w//scale),max(1,h//scale)),Image.Resampling.BILINEAR)
    if rng.random()<.65:
        small=small.filter(ImageFilter.GaussianBlur(rng.uniform(.15,.65)))
    # PS2-like palette pressure without relying on copyrighted source assets.
    colours=rng.choice((32,64,128,256))
    alpha=small.getchannel("A")
    rgb=small.convert("RGB").quantize(colors=colours,method=Image.Quantize.MEDIANCUT).convert("RGB")
    low=Image.merge("RGBA",(*rgb.split(),alpha))
    return low.resize((w,h),Image.Resampling.BILINEAR)

def main() -> None:
    ap=argparse.ArgumentParser()
    ap.add_argument("source",type=Path,help="Directory of user-owned/licensed high-resolution reference assets")
    ap.add_argument("output",type=Path)
    ap.add_argument("--patch",type=int,default=128)
    ap.add_argument("--stride",type=int,default=96)
    ap.add_argument("--max-per-image",type=int,default=256)
    args=ap.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    manifest=(args.output/"manifest.jsonl").open("w",encoding="utf-8")
    count=0
    for path in sorted(p for p in args.source.rglob("*") if p.suffix.lower() in EXT):
        try: im=Image.open(path).convert("RGBA")
        except Exception: continue
        if im.width<args.patch or im.height<args.patch: continue
        rel=path.relative_to(args.source).as_posix()
        mat=material(path)
        made=0
        for y in range(0,im.height-args.patch+1,args.stride):
            for x in range(0,im.width-args.patch+1,args.stride):
                if made>=args.max_per_image: break
                target=im.crop((x,y,x+args.patch,y+args.patch))
                digest=hashlib.sha256((rel+f":{x}:{y}").encode()).hexdigest()
                low=degrade(target,int(digest[:16],16))
                folder=args.output/split_for(rel)/mat
                folder.mkdir(parents=True,exist_ok=True)
                stem=digest[:24]
                input_path=folder/f"{stem}-input.png"
                target_path=folder/f"{stem}-target.png"
                low.save(input_path,optimize=True)
                target.save(target_path,optimize=True)
                row={
                    "id":stem,"source":rel,"material":mat,"split":split_for(rel),
                    "input":input_path.relative_to(args.output).as_posix(),
                    "target":target_path.relative_to(args.output).as_posix(),
                    "patch":[x,y,args.patch,args.patch],
                    "source_sha256":hashlib.sha256(path.read_bytes()).hexdigest(),
                }
                manifest.write(json.dumps(row,separators=(",",":"))+"\n")
                count+=1;made+=1
            if made>=args.max_per_image: break
    manifest.close()
    print(json.dumps({"pairs":count,"manifest":str(args.output/"manifest.jsonl")},indent=2))

if __name__=="__main__": main()
