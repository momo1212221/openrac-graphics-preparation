#!/usr/bin/env python3
"""Fast CPU smoke test for the specialized material-detail CNN."""
from __future__ import annotations

import importlib.util
import math
import tempfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

ROOT=Path(__file__).resolve().parents[1]
TRAIN=ROOT/"tools"/"training"/"train_detail.py"
spec=importlib.util.spec_from_file_location("openrac_train_detail",TRAIN)
train_detail=importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(train_detail)

def assert_close(a,b,eps=1e-7):
    if not torch.allclose(a,b,atol=eps,rtol=0):
        raise AssertionError(f"tensors differ; max error={float((a-b).abs().max())}")

def main():
    train_detail.seed_everything(1234)

    # 1) Safety invariant: a new specialized CNN is exactly identity.
    model=train_detail.DetailCNN(c=8,blocks=1).cpu().eval()
    x=torch.rand(2,3,16,16)
    with torch.no_grad():
        y=model(x)
    assert_close(y,x)

    # 2) Fidelity loss must be exactly zero for a perfect reconstruction.
    loss,colour,gx,gy=train_detail.fidelity_loss(x,x,nn.L1Loss(),gradient_weight=.35)
    for value in (loss,colour,gx,gy):
        if float(value)!=0.0:
            raise AssertionError(f"perfect reconstruction produced non-zero loss: {float(value)}")

    # 3) Backprop must reach the zero-initialized residual tail and update it.
    model=train_detail.DetailCNN(c=8,blocks=1).cpu().train()
    opt=torch.optim.AdamW(model.parameters(),lr=1e-3)
    target=torch.clamp(x*.82+.07,0,1)
    before=model.tail.weight.detach().clone()
    out=model(x)
    loss,_,_,_=train_detail.fidelity_loss(out,target,nn.L1Loss(),gradient_weight=.35)
    opt.zero_grad(set_to_none=True)
    loss.backward()
    grad=model.tail.weight.grad
    if grad is None or not torch.isfinite(grad).all() or float(grad.abs().sum())<=0:
        raise AssertionError("residual tail did not receive a finite non-zero gradient")
    torch.nn.utils.clip_grad_norm_(model.parameters(),1.0)
    opt.step()
    if torch.equal(before,model.tail.weight.detach()):
        raise AssertionError("optimizer step did not change residual tail weights")

    # 4) Validation selection must keep an untouched identity model at the baseline.
    identity=train_detail.DetailCNN(c=8,blocks=1).cpu().eval()
    held_x=torch.rand(4,3,16,16)
    held_target=torch.clamp(held_x*.9+.04,0,1)
    loader=DataLoader(TensorDataset(held_x,held_target),batch_size=2,shuffle=False)
    report=train_detail.evaluate(identity,loader,"cpu",nn.L1Loss(),gradient_weight=.35)
    if report is None:
        raise AssertionError("validation unexpectedly returned no report")
    if not math.isclose(report["selection_score"],1.0,rel_tol=0,abs_tol=1e-6):
        raise AssertionError(f"identity baseline selection score is not 1: {report['selection_score']}")
    if report["release_gate_pass"]:
        raise AssertionError("identity baseline must not pass the release gate")

    # 5) Exported ONNX must preserve dynamic spatial dimensions and run on CPU ORT.
    model=model.eval()
    with tempfile.TemporaryDirectory() as td:
        path=Path(td)/"detail-smoke.onnx"
        dummy=torch.zeros(1,3,16,16)
        torch.onnx.export(
            model,dummy,path,
            input_names=["input"],output_names=["output"],
            dynamic_axes={"input":{2:"height",3:"width"},"output":{2:"height",3:"width"}},
            opset_version=18,dynamo=False,
        )
        session=ort.InferenceSession(str(path),providers=["CPUExecutionProvider"])
        sample=np.random.default_rng(7).random((1,3,11,13),dtype=np.float32)
        result=session.run(None,{session.get_inputs()[0].name:sample})[0]
        if result.shape!=sample.shape:
            raise AssertionError(f"ONNX dynamic shape mismatch: {result.shape} != {sample.shape}")
        if not np.isfinite(result).all():
            raise AssertionError("ONNX inference returned NaN/Inf")
        if float(result.min()) < -1e-5 or float(result.max()) > 1.00001:
            raise AssertionError("ONNX output escaped the expected [0,1] range")

    print("CNN training smoke test passed: identity, fidelity loss, gradients, validation gate and ONNX inference.")

if __name__=="__main__":
    main()
