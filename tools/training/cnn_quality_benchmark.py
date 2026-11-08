#!/usr/bin/env python3
"""Benchmark the pinned Real-ESRGAN runtime CNNs against deterministic HR references."""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image


def input_hw(session: ort.InferenceSession) -> tuple[int, int]:
    shape=session.get_inputs()[0].shape
    if len(shape)!=4:
        raise AssertionError(f"expected NCHW input, got {shape}")
    h=int(shape[2]) if isinstance(shape[2],int) and shape[2]>0 else 128
    w=int(shape[3]) if isinstance(shape[3],int) and shape[3]>0 else 128
    return h,w


def resize_rgb(arr: np.ndarray, size: tuple[int,int], resample: int) -> np.ndarray:
    img=Image.fromarray(np.clip(np.rint(arr*255),0,255).astype(np.uint8),"RGB")
    out=img.resize(size,resample=resample)
    return np.asarray(out,dtype=np.float32)/255.0


def smooth_noise(rng: np.random.Generator, h: int, w: int, cells: int=20) -> np.ndarray:
    small=rng.random((cells,cells,3),dtype=np.float32)
    return resize_rgb(small,(w,h),Image.Resampling.BICUBIC)


def make_reference(kind: str, h: int, w: int) -> np.ndarray:
    yy,xx=np.indices((h,w),dtype=np.float32)
    x=xx/max(1,w-1)
    y=yy/max(1,h-1)
    rng=np.random.default_rng(20261108+sum(map(ord,kind)))

    if kind=="stone":
        n=smooth_noise(rng,h,w,24)
        ridge=(np.sin(x*math.tau*8.0+y*math.tau*3.0)+np.sin(x*math.tau*19.0-y*math.tau*11.0))*.5
        base=np.stack([
            .39+.11*ridge,.34+.09*ridge,.29+.07*ridge
        ],axis=2)
        return np.clip(base+(n-.5)*.18,0,1)

    if kind=="fabric":
        warp=np.sin(xx*math.tau/11.0)
        weft=np.sin(yy*math.tau/13.0)
        weave=(warp*weft)*.12 + (warp+weft)*.035
        base=np.stack([
            .56+weave,.27+weave*.58,.18+weave*.35
        ],axis=2)
        return np.clip(base,0,1)

    if kind=="metal":
        grad=.30+.38*x
        brushed=np.sin((xx+yy*.35)*math.tau/19.0)*.035
        scratches=np.zeros((h,w),dtype=np.float32)
        for offset in (31,77,119,181,263,349):
            d=np.abs((xx+yy*.58)-offset)
            scratches-=np.exp(-(d*d)/4.0)*.18
        l=np.clip(grad+brushed+scratches,0,1)
        return np.stack([l*.94,l*.98,np.minimum(1,l*1.04)],axis=2)

    if kind=="organic":
        r=np.hypot(x-.48,y-.53)
        veins=np.sin((x*9.0+y*13.0+r*7.0)*math.tau)*.055
        blobs=np.sin(x*math.tau*2.2)*np.cos(y*math.tau*2.7)*.09
        return np.clip(np.stack([
            .22+blobs+veins,.43+blobs*.65+veins*.55,.18+blobs*.35+veins*.25
        ],axis=2),0,1)

    if kind=="sky":
        l=.14+.46*(1-y)
        out=np.stack([l*.55,l*.74,np.minimum(1,l*1.20+.08)],axis=2)
        for sx,sy,amp in [(0.14,.22,.7),(.33,.37,.55),(.66,.18,.8),(.82,.44,.6),(.51,.61,.5)]:
            d2=((x-sx)*w)**2+((y-sy)*h)**2
            glow=np.exp(-d2/18.0)*amp
            out+=glow[...,None]*np.array([.95,.98,1.0],dtype=np.float32)
        return np.clip(out,0,1)

    raise ValueError(kind)


def run_model(session: ort.InferenceSession, lr: np.ndarray) -> tuple[np.ndarray,dict]:
    inp=np.transpose(lr,(2,0,1))[None].astype(np.float32)
    raw=np.asarray(session.run(None,{session.get_inputs()[0].name:inp})[0],dtype=np.float32)
    if raw.ndim!=4 or raw.shape[0]!=1 or raw.shape[1]!=3:
        raise AssertionError(f"unexpected output shape {raw.shape}")
    rgb=np.transpose(raw[0],(1,2,0))
    over=np.logical_or(rgb<0,rgb>1)
    meta={
        "raw_min":float(rgb.min()),
        "raw_max":float(rgb.max()),
        "overshoot_ratio":float(over.mean()),
    }
    return np.clip(rgb,0,1),meta


def luma(a: np.ndarray) -> np.ndarray:
    return a[...,0]*.299+a[...,1]*.587+a[...,2]*.114


def global_ssim(pred: np.ndarray, target: np.ndarray) -> float:
    p=luma(pred).astype(np.float64)
    t=luma(target).astype(np.float64)
    mp=float(p.mean()); mt=float(t.mean())
    vp=float(((p-mp)**2).mean()); vt=float(((t-mt)**2).mean())
    cov=float(((p-mp)*(t-mt)).mean())
    c1=(.01**2); c2=(.03**2)
    denom=(mp*mp+mt*mt+c1)*(vp+vt+c2)
    if denom<=1e-15:
        return 1.0 if np.allclose(p,t) else 0.0
    return float(((2*mp*mt+c1)*(2*cov+c2))/denom)


def metrics(pred: np.ndarray, target: np.ndarray) -> dict:
    diff=pred-target
    mse=float(np.mean(diff*diff))
    mae=float(np.mean(np.abs(diff)))
    psnr=99.0 if mse<=1e-12 else float(10*math.log10(1.0/mse))
    p=luma(pred);t=luma(target)
    pgx=np.diff(p,axis=1);pgy=np.diff(p,axis=0)
    tgx=np.diff(t,axis=1);tgy=np.diff(t,axis=0)
    grad_mae=float((np.mean(np.abs(pgx-tgx))+np.mean(np.abs(pgy-tgy)))*.5)
    target_energy=float((np.mean(np.abs(tgx))+np.mean(np.abs(tgy)))*.5)
    pred_energy=float((np.mean(np.abs(pgx))+np.mean(np.abs(pgy)))*.5)
    edge_ratio=pred_energy/max(target_energy,1e-9)
    chroma=np.mean(np.abs((pred-pred.mean(axis=2,keepdims=True))-(target-target.mean(axis=2,keepdims=True))))
    return {
        "mae_255":round(mae*255,4),
        "psnr_db":round(psnr,4),
        "ssim":round(global_ssim(pred,target),6),
        "gradient_mae_255":round(grad_mae*255,4),
        "edge_energy_ratio":round(edge_ratio,4),
        "chroma_error_255":round(float(chroma)*255,4),
    }


def rgba_bytes(rgb: np.ndarray) -> bytes:
    u=np.clip(np.rint(rgb*255),0,255).astype(np.uint8)
    alpha=np.full((u.shape[0],u.shape[1],1),255,dtype=np.uint8)
    return np.concatenate([u,alpha],axis=2).tobytes()


def rgb_from_rgba(path: Path, h: int, w: int) -> np.ndarray:
    raw=np.frombuffer(path.read_bytes(),dtype=np.uint8)
    if raw.size!=h*w*4:
        raise AssertionError(f"bad fused byte count {raw.size}, expected {h*w*4}")
    return raw.reshape(h,w,4)[...,:3].astype(np.float32)/255.0


def fuse_exact(runner: Path, base: np.ndarray, detail: np.ndarray, material: str, work: Path) -> tuple[np.ndarray,dict]:
    h,w=base.shape[:2]
    base_path=work/f"{material}-base.rgba"
    detail_path=work/f"{material}-detail.rgba"
    out_path=work/f"{material}-fused.rgba"
    cfg_path=work/f"{material}-fusion.json"
    base_path.write_bytes(rgba_bytes(base))
    detail_path.write_bytes(rgba_bytes(detail))
    cfg_path.write_text(json.dumps({
        "width":w,"height":h,"base":str(base_path),"detail":str(detail_path),
        "output":str(out_path),"quality":"max","material":material,
    }),encoding="utf-8")
    cp=subprocess.run(["node",str(runner),str(cfg_path)],check=True,text=True,capture_output=True)
    fusion=json.loads(cp.stdout.strip().splitlines()[-1])
    return rgb_from_rgba(out_path,h,w),fusion


def save_preview(path: Path, arr: np.ndarray) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    Image.fromarray(np.clip(np.rint(arr*255),0,255).astype(np.uint8),"RGB").save(path)


def main() -> None:
    ap=argparse.ArgumentParser()
    ap.add_argument("base_model",type=Path)
    ap.add_argument("detail_model",type=Path)
    ap.add_argument("--output",type=Path,default=Path("cnn-quality-report.json"))
    ap.add_argument("--preview-dir",type=Path,default=Path("cnn-quality-previews"))
    args=ap.parse_args()

    base_session=ort.InferenceSession(str(args.base_model),providers=["CPUExecutionProvider"])
    detail_session=ort.InferenceSession(str(args.detail_model),providers=["CPUExecutionProvider"])
    bh,bw=input_hw(base_session);dh,dw=input_hw(detail_session)
    if (bh,bw)!=(dh,dw):
        raise AssertionError(f"model input mismatch: base {(bh,bw)} detail {(dh,dw)}")

    out_h,out_w=bh*4,bw*4
    runner=Path(__file__).with_name("fuse_benchmark_outputs.mjs")
    cases=["stone","fabric","metal","organic","sky"]
    report={"version":2,"input":[bw,bh],"output":[out_w,out_h],"cases":[]}
    quality_wins={"base":0,"detail":0,"fused":0,"bicubic":0}

    with tempfile.TemporaryDirectory() as td:
        work=Path(td)
        for kind in cases:
            target=make_reference(kind,out_h,out_w)
            lr=resize_rgb(target,(bw,bh),Image.Resampling.LANCZOS)
            bicubic=resize_rgb(lr,(out_w,out_h),Image.Resampling.BICUBIC)
            base,base_raw=run_model(base_session,lr)
            detail,detail_raw=run_model(detail_session,lr)
            fused,fusion=fuse_exact(runner,base,detail,kind,work)

            rows={
                "bicubic":metrics(bicubic,target),
                "x4plus":metrics(base,target),
                "general_x4v3":metrics(detail,target),
                "fused":metrics(fused,target),
            }
            best=min(rows,key=lambda k:(rows[k]["gradient_mae_255"],rows[k]["mae_255"]))
            if best=="x4plus":quality_wins["base"]+=1
            elif best=="general_x4v3":quality_wins["detail"]+=1
            else:quality_wins[best]+=1

            prefix=args.preview_dir/kind
            save_preview(prefix/"target.png",target)
            save_preview(prefix/"lowres.png",lr)
            save_preview(prefix/"bicubic.png",bicubic)
            save_preview(prefix/"x4plus.png",base)
            save_preview(prefix/"general-x4v3.png",detail)
            save_preview(prefix/"fused.png",fused)

            base_metrics=rows["x4plus"]
            fused_metrics=rows["fused"]
            # The detail CNN is optional enrichment. It must never materially degrade the
            # authoritative x4plus reconstruction just to increase apparent detail.
            gradient_regression=fused_metrics["gradient_mae_255"]/max(base_metrics["gradient_mae_255"],1e-9)-1
            mae_regression=fused_metrics["mae_255"]/max(base_metrics["mae_255"],1e-9)-1
            ssim_regression=base_metrics["ssim"]-fused_metrics["ssim"]
            case_gate={
                "gradient_regression_le_3pct":gradient_regression<=.03,
                "mae_regression_le_3pct":mae_regression<=.03,
                "ssim_drop_le_0_01":ssim_regression<=.01,
                "fusion_confidence_valid":0<=fusion["confidence"]<=1,
                "fusion_agreement_valid":0<=fusion["agreement"]<=1,
                "base_overshoot_le_5pct":base_raw["overshoot_ratio"]<=.05,
                "detail_overshoot_le_5pct":detail_raw["overshoot_ratio"]<=.05,
            }
            report["cases"].append({
                "name":kind,
                "metrics":rows,
                "base_raw":base_raw,
                "detail_raw":detail_raw,
                "fusion":fusion,
                "best_gradient_first":best,
                "relative_to_x4plus":{
                    "gradient_regression":round(gradient_regression,6),
                    "mae_regression":round(mae_regression,6),
                    "ssim_regression":round(ssim_regression,6),
                },
                "gate":case_gate,
                "gate_ok":all(case_gate.values()),
            })

    report["wins"]=quality_wins
    report["summary"]={
        "mean_gradient_mae_255":{
            name:round(float(np.mean([c["metrics"][name]["gradient_mae_255"] for c in report["cases"]])),4)
            for name in ("bicubic","x4plus","general_x4v3","fused")
        },
        "mean_mae_255":{
            name:round(float(np.mean([c["metrics"][name]["mae_255"] for c in report["cases"]])),4)
            for name in ("bicubic","x4plus","general_x4v3","fused")
        },
        "mean_fusion_confidence":round(float(np.mean([c["fusion"]["confidence"] for c in report["cases"]])),4),
        "mean_fusion_agreement":round(float(np.mean([c["fusion"]["agreement"] for c in report["cases"]])),4),
        "mean_rejected_ratio":round(float(np.mean([
            c["fusion"]["rejectedPixels"]/max(1,c["fusion"]["consideredPixels"]) for c in report["cases"]
        ])),4),
        "mean_psnr_db":{
            name:round(float(np.mean([c["metrics"][name]["psnr_db"] for c in report["cases"]])),4)
            for name in ("bicubic","x4plus","general_x4v3","fused")
        },
        "mean_ssim":{
            name:round(float(np.mean([c["metrics"][name]["ssim"] for c in report["cases"]])),6)
            for name in ("bicubic","x4plus","general_x4v3","fused")
        },
    }
    base_mean_grad=report["summary"]["mean_gradient_mae_255"]["x4plus"]
    fused_mean_grad=report["summary"]["mean_gradient_mae_255"]["fused"]
    base_mean_mae=report["summary"]["mean_mae_255"]["x4plus"]
    fused_mean_mae=report["summary"]["mean_mae_255"]["fused"]
    base_mean_ssim=report["summary"]["mean_ssim"]["x4plus"]
    fused_mean_ssim=report["summary"]["mean_ssim"]["fused"]
    report["regression_gate"]={
        "all_cases_pass":all(c["gate_ok"] for c in report["cases"]),
        "mean_gradient_regression_le_2pct":fused_mean_grad<=base_mean_grad*1.02,
        "mean_mae_regression_le_2pct":fused_mean_mae<=base_mean_mae*1.02,
        "mean_ssim_drop_le_0_005":fused_mean_ssim>=base_mean_ssim-.005,
    }
    report["ok"]=all(report["regression_gate"].values()) and all(
        np.isfinite(c["base_raw"]["raw_min"]) and np.isfinite(c["detail_raw"]["raw_min"])
        for c in report["cases"]
    )
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print(json.dumps(report,indent=2))
    if not report["ok"]:
        raise SystemExit(2)


if __name__=="__main__":
    main()
