#!/usr/bin/env python3
"""Promote only a validated specialized detail model into the runtime models directory."""
from __future__ import annotations
import argparse, hashlib, json, shutil
from pathlib import Path

ALLOWED={"weapon","character","terrain","stone","metal","fabric","organic","glass","energy","sky","generic"}
PINNED_BASE_X4PLUS_SHA256="a64fb7ec8780e6e67a99cf380067961a0aab618c934171240eea2724217fd304"

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
    if int(report.get("version",0))<3:
        raise SystemExit("validation report is too old; runtime-aligned Laplacian validation is required")
    if report.get("dataset_input_pipeline")!="base-cnn-reconstruction":
        raise SystemExit("release promotion requires a runtime-aligned base-CNN reconstruction dataset")
    if report.get("base_model_sha256")!=PINNED_BASE_X4PLUS_SHA256:
        raise SystemExit("training base model does not match the pinned runtime x4plus SHA-256")
    if not (float(report.get("laplacian_improvement",0))>0):
        raise SystemExit("promotion requires positive Laplacian fidelity improvement")
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
        "laplacian_improvement":report.get("laplacian_improvement"),
        "dataset_manifest_sha256":report.get("dataset_manifest_sha256"),
        "dataset_input_pipeline":report.get("dataset_input_pipeline"),
        "base_model_sha256":report.get("base_model_sha256"),
        "validation_pairs":report.get("pairs"),
        "validation_sources":report.get("unique_sources"),
    }
    manifest.write_text(json.dumps(data,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print(json.dumps({"material":material,"model":str(target),"manifest":str(manifest)},indent=2))

if __name__=="__main__": main()
