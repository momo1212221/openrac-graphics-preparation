#!/usr/bin/env python3
"""Validate a trained detail CNN against held-out synthetic pairs and emit release metadata."""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path
import numpy as np
from PIL import Image
import torch
import onnxruntime as ort

def load(path:Path):
    a=np.asarray(Image.open(path).convert("RGB"),dtype=np.float32)/255.
    return a

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("dataset",type=Path);ap.add_argument("model",type=Path)
    ap.add_argument("--material",default="all");ap.add_argument("--limit",type=int,default=500)
    ap.add_argument("--output",type=Path,default=Path("model-validation.json"))
    args=ap.parse_args()
    rows=[json.loads(x) for x in (args.dataset/"manifest.jsonl").read_text().splitlines() if x.strip()]
    rows=[r for r in rows if r["split"] in ("validation","test") and (args.material=="all" or r["material"]==args.material)]
    rows=rows[:args.limit]
    if not rows: raise SystemExit("no validation/test pairs")
    session=ort.InferenceSession(str(args.model),providers=["CPUExecutionProvider"])
    name=session.get_inputs()[0].name
    l1_before=l1_after=grad_before=grad_after=0.
    for r in rows:
        inp=load(args.dataset/r["input"]);target=load(args.dataset/r["target"])
        out=session.run(None,{name:inp.transpose(2,0,1)[None].astype(np.float32)})[0][0].transpose(1,2,0)
        out=np.clip(out,0,1)
        l1_before+=float(np.abs(inp-target).mean());l1_after+=float(np.abs(out-target).mean())
        def grad(a):
            return np.concatenate([(a[:,1:]-a[:,:-1]).reshape(-1,3),(a[1:]-a[:-1]).reshape(-1,3)])
        gt=grad(target)
        grad_before+=float(np.abs(grad(inp)-gt).mean());grad_after+=float(np.abs(grad(out)-gt).mean())
    n=len(rows)
    result={
      "version":1,"material":args.material,"pairs":n,
      "model_sha256":hashlib.sha256(args.model.read_bytes()).hexdigest(),
      "l1_before":l1_before/n,"l1_after":l1_after/n,
      "gradient_l1_before":grad_before/n,"gradient_l1_after":grad_after/n,
    }
    result["l1_improvement"]=(result["l1_before"]-result["l1_after"])/max(result["l1_before"],1e-9)
    result["gradient_improvement"]=(result["gradient_l1_before"]-result["gradient_l1_after"])/max(result["gradient_l1_before"],1e-9)
    result["release_candidate"]=result["l1_improvement"]>0 and result["gradient_improvement"]>0
    args.output.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(result,indent=2))
    if not result["release_candidate"]: raise SystemExit(2)

if __name__=="__main__": main()
