#!/usr/bin/env python3
"""Validate a trained detail CNN against held-out synthetic pairs and emit release metadata."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image
import onnxruntime as ort

def load(path:Path):
    a=np.asarray(Image.open(path).convert("RGB"),dtype=np.float32)/255.
    return a

def sha256_file(path:Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("dataset",type=Path)
    ap.add_argument("model",type=Path)
    ap.add_argument("--material",default="all")
    ap.add_argument("--limit",type=int,default=500)
    ap.add_argument("--output",type=Path,default=Path("model-validation.json"))
    ap.add_argument("--min-l1-improvement",type=float,default=0.0)
    ap.add_argument("--min-gradient-improvement",type=float,default=0.0)
    ap.add_argument("--min-laplacian-improvement",type=float,default=0.0)
    args=ap.parse_args()

    manifest=args.dataset/"manifest.jsonl"
    rows=[json.loads(x) for x in manifest.read_text(encoding="utf-8").splitlines() if x.strip()]
    rows=[
        r for r in rows
        if r["split"] in ("validation","test") and
        (args.material=="all" or r["material"]==args.material)
    ]
    rows=rows[:args.limit]
    if not rows:
        raise SystemExit("no validation/test pairs")

    providers=["CPUExecutionProvider"]
    session=ort.InferenceSession(str(args.model),providers=providers)
    input_info=session.get_inputs()[0]
    output_info=session.get_outputs()[0]
    if len(input_info.shape)!=4 or len(output_info.shape)!=4:
        raise SystemExit("model must expose NCHW input and output")
    name=input_info.name

    l1_before=l1_after=grad_before=grad_after=lap_before=lap_after=0.0
    split_counts=Counter()
    sources=set()
    worst=[]
    for r in rows:
        inp=load(args.dataset/r["input"])
        target=load(args.dataset/r["target"])
        out=session.run(None,{name:inp.transpose(2,0,1)[None].astype(np.float32)})[0][0].transpose(1,2,0)
        out=np.clip(out,0,1)
        before=float(np.abs(inp-target).mean())
        after=float(np.abs(out-target).mean())
        l1_before+=before
        l1_after+=after

        def grad(a):
            return np.concatenate([
                (a[:,1:]-a[:,:-1]).reshape(-1,3),
                (a[1:]-a[:-1]).reshape(-1,3),
            ])
        gt=grad(target)
        gb=float(np.abs(grad(inp)-gt).mean())
        ga=float(np.abs(grad(out)-gt).mean())
        grad_before+=gb
        grad_after+=ga

        def lap(a):
            p=np.pad(a,((1,1),(1,1),(0,0)),mode="edge")
            return (
                p[1:-1,:-2]+p[1:-1,2:]+p[:-2,1:-1]+p[2:,1:-1]-4*a
            )
        lt=lap(target)
        lb=float(np.abs(lap(inp)-lt).mean())
        la=float(np.abs(lap(out)-lt).mean())
        lap_before+=lb
        lap_after+=la
        split_counts[r["split"]]+=1
        sources.add(r.get("source_sha256") or r.get("source"))
        worst.append({
            "id":r.get("id"),
            "split":r["split"],
            "source":r.get("source"),
            "l1_before":before,
            "l1_after":after,
            "gradient_before":gb,
            "gradient_after":ga,
            "laplacian_before":lb,
            "laplacian_after":la,
            "l1_improvement":(before-after)/max(before,1e-9),
        })

    n=len(rows)
    dataset_summary={}
    summary_path=args.dataset/"dataset-summary.json"
    if summary_path.is_file():
        try:
            dataset_summary=json.loads(summary_path.read_text(encoding="utf-8"))
        except Exception:
            dataset_summary={}

    result={
        "version":3,
        "material":args.material,
        "pairs":n,
        "unique_sources":len(sources),
        "split_counts":dict(sorted(split_counts.items())),
        "dataset_manifest_sha256":sha256_file(manifest),
        "dataset_input_pipeline":dataset_summary.get("input_pipeline"),
        "base_model_sha256":dataset_summary.get("base_model_sha256"),
        "model_sha256":sha256_file(args.model),
        "model_bytes":args.model.stat().st_size,
        "input_name":input_info.name,
        "output_name":output_info.name,
        "providers":providers,
        "l1_before":l1_before/n,
        "l1_after":l1_after/n,
        "gradient_l1_before":grad_before/n,
        "gradient_l1_after":grad_after/n,
        "laplacian_l1_before":lap_before/n,
        "laplacian_l1_after":lap_after/n,
        "thresholds":{
            "min_l1_improvement":args.min_l1_improvement,
            "min_gradient_improvement":args.min_gradient_improvement,
            "min_laplacian_improvement":args.min_laplacian_improvement,
        },
    }
    result["l1_improvement"]=(result["l1_before"]-result["l1_after"])/max(result["l1_before"],1e-9)
    result["gradient_improvement"]=(result["gradient_l1_before"]-result["gradient_l1_after"])/max(result["gradient_l1_before"],1e-9)
    result["laplacian_improvement"]=(result["laplacian_l1_before"]-result["laplacian_l1_after"])/max(result["laplacian_l1_before"],1e-9)
    result["release_candidate"]=(
        result["l1_improvement"]>args.min_l1_improvement and
        result["gradient_improvement"]>args.min_gradient_improvement and
        result["laplacian_improvement"]>args.min_laplacian_improvement
    )
    result["worst_examples"]=sorted(worst,key=lambda r:r["l1_improvement"])[:20]

    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print(json.dumps(result,indent=2))
    if not result["release_candidate"]:
        raise SystemExit(2)

if __name__=="__main__":
    main()
