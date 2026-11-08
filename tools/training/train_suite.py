#!/usr/bin/env python3
"""Train and validate a suite of specialized material-detail models without auto-promoting them."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

DEFAULT_MATERIALS=[
    "weapon","character","terrain","stone","metal","fabric",
    "organic","glass","energy","sky","generic",
]

def run(cmd,allowed=(0,)):
    print("+"," ".join(str(x) for x in cmd),flush=True)
    completed=subprocess.run([str(x) for x in cmd],check=False)
    if completed.returncode not in allowed:
        raise subprocess.CalledProcessError(completed.returncode,[str(x) for x in cmd])
    return completed.returncode

def dataset_counts(dataset:Path):
    rows=[
        json.loads(x)
        for x in (dataset/"manifest.jsonl").read_text(encoding="utf-8").splitlines()
        if x.strip()
    ]
    counts=Counter((r["material"],r["split"]) for r in rows)
    return counts

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("dataset",type=Path)
    ap.add_argument("output",type=Path,help="Directory for candidate ONNX models, checkpoints and validation reports")
    ap.add_argument("--materials",default=",".join(DEFAULT_MATERIALS))
    ap.add_argument("--epochs",type=int,default=30)
    ap.add_argument("--batch",type=int,default=16)
    ap.add_argument("--lr",type=float,default=2e-4)
    ap.add_argument("--gradient-weight",type=float,default=.35)
    ap.add_argument("--device",default="auto")
    ap.add_argument("--workers",type=int,default=2)
    ap.add_argument("--seed",type=int,default=1337)
    ap.add_argument("--patience",type=int,default=6)
    ap.add_argument("--augment",action="store_true")
    ap.add_argument("--resume",action="store_true")
    ap.add_argument("--continue-on-error",action="store_true")
    ap.add_argument("--validation-limit",type=int,default=500)
    ap.add_argument("--min-l1-improvement",type=float,default=0.0)
    ap.add_argument("--min-gradient-improvement",type=float,default=0.0)
    args=ap.parse_args()

    materials=[m.strip() for m in args.materials.split(",") if m.strip()]
    unknown=[m for m in materials if m not in DEFAULT_MATERIALS and m!="all"]
    if unknown:
        raise SystemExit("unsupported material(s): "+", ".join(unknown))
    args.output.mkdir(parents=True,exist_ok=True)
    counts=dataset_counts(args.dataset)
    root=Path(__file__).resolve().parent
    train_script=root/"train_detail.py"
    validate_script=root/"validate_detail.py"
    summary=[]

    for index,material in enumerate(materials):
        train_pairs=sum(v for (m,s),v in counts.items() if s=="train" and (material=="all" or m==material))
        heldout_pairs=sum(v for (m,s),v in counts.items() if s in ("validation","test") and (material=="all" or m==material))
        row={"material":material,"train_pairs":train_pairs,"heldout_pairs":heldout_pairs}
        if not train_pairs:
            row.update(status="skipped",reason="no training pairs")
            summary.append(row)
            continue
        if not heldout_pairs:
            row.update(status="skipped",reason="no validation/test pairs")
            summary.append(row)
            continue

        model=args.output/f"detail-{material}-candidate.onnx"
        checkpoint=args.output/f"detail-{material}.checkpoint.pt"
        validation=args.output/f"detail-{material}.validation.json"
        cmd=[
            sys.executable,train_script,args.dataset,model,
            "--material",material,
            "--epochs",str(args.epochs),
            "--batch",str(args.batch),
            "--lr",str(args.lr),
            "--gradient-weight",str(args.gradient_weight),
            "--device",args.device,
            "--workers",str(args.workers),
            "--seed",str(args.seed+index),
            "--patience",str(args.patience),
            "--checkpoint",checkpoint,
        ]
        if args.augment:
            cmd.append("--augment")
        if args.resume and checkpoint.exists():
            cmd.append("--resume")
        try:
            run(cmd)
            validation_exit=run([
                sys.executable,validate_script,args.dataset,model,
                "--material",material,
                "--limit",str(args.validation_limit),
                "--min-l1-improvement",str(args.min_l1_improvement),
                "--min-gradient-improvement",str(args.min_gradient_improvement),
                "--output",validation,
            ],allowed=(0,2))
            report=json.loads(validation.read_text(encoding="utf-8"))
            row.update(
                status="validated",
                validation_exit_code=validation_exit,
                model=str(model),
                checkpoint=str(checkpoint),
                validation=str(validation),
                release_candidate=report.get("release_candidate") is True,
                l1_improvement=report.get("l1_improvement"),
                gradient_improvement=report.get("gradient_improvement"),
            )
        except subprocess.CalledProcessError as exc:
            row.update(status="failed",exit_code=exc.returncode)
            summary.append(row)
            if not args.continue_on_error:
                out=args.output/"training-suite-summary.json"
                out.write_text(json.dumps({"models":summary},indent=2)+"\n",encoding="utf-8")
                raise
            continue
        summary.append(row)

    out=args.output/"training-suite-summary.json"
    out.write_text(json.dumps({"version":1,"models":summary},indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"summary":str(out),"models":summary},indent=2))

if __name__=="__main__":
    main()
