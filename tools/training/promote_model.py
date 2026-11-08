#!/usr/bin/env python3
"""Promote only a validated specialized detail model into the runtime models directory."""
from __future__ import annotations
import argparse, hashlib, json, shutil
from pathlib import Path

ALLOWED={"weapon","character","terrain","stone","metal","fabric","organic","glass","energy","sky","generic"}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("model",type=Path)
    ap.add_argument("validation",type=Path)
    ap.add_argument("--root",type=Path,default=Path(__file__).resolve().parents[2])
    args=ap.parse_args()
    report=json.loads(args.validation.read_text(encoding="utf-8"))
    material=str(report.get("material",""))
    if material not in ALLOWED: raise SystemExit(f"unsupported material: {material}")
    if report.get("release_candidate") is not True: raise SystemExit("validation is not a release candidate")
    digest=hashlib.sha256(args.model.read_bytes()).hexdigest()
    if digest!=report.get("model_sha256"): raise SystemExit("validation SHA-256 does not match model")
    models=args.root/"models";models.mkdir(parents=True,exist_ok=True)
    target=models/f"detail-{material}.onnx"
    validation=models/f"detail-{material}.validation.json"
    shutil.copyfile(args.model,target)
    shutil.copyfile(args.validation,validation)
    manifest=models/"specialized-models.json"
    data={"version":1,"models":{}}
    if manifest.exists(): data=json.loads(manifest.read_text(encoding="utf-8"))
    if data.get("version")!=1 or not isinstance(data.get("models"),dict):
        raise SystemExit("invalid specialized model manifest")
    data["models"][material]={
        "file":target.name,
        "sha256":digest,
        "validation":validation.name,
        "l1_improvement":report["l1_improvement"],
        "gradient_improvement":report["gradient_improvement"],
        "dataset_manifest_sha256":report.get("dataset_manifest_sha256"),
        "dataset_input_pipeline":report.get("dataset_input_pipeline"),
        "base_model_sha256":report.get("base_model_sha256"),
        "validation_pairs":report.get("pairs"),
        "validation_sources":report.get("unique_sources"),
    }
    manifest.write_text(json.dumps(data,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print(json.dumps({"material":material,"model":str(target),"manifest":str(manifest)},indent=2))

if __name__=="__main__": main()
