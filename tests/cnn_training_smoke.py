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
import torch.nn.functional as F
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

    # 5) The CNN must actually learn source-derived detail on held-out inputs.
    # The target is a conservative high-frequency residual computed from the input itself,
    # so improvement measures reconstruction ability rather than memorising invented texture.
    torch.manual_seed(42)
    learn_x=torch.rand(10,3,16,16)*.65+.175
    learn_blur=F.avg_pool2d(learn_x,3,1,1)
    learn_y=torch.clamp(learn_x+(learn_x-learn_blur)*.22,0,1)
    train_x,train_y=learn_x[:8],learn_y[:8]
    val_x,val_y=learn_x[8:],learn_y[8:]
    learner=train_detail.DetailCNN(c=8,blocks=1).cpu().train()
    learner_opt=torch.optim.AdamW(learner.parameters(),lr=2e-3)
    with torch.no_grad():
        initial,initial_colour,initial_gx,initial_gy=train_detail.fidelity_loss(
            learner(val_x),val_y,nn.L1Loss(),gradient_weight=.35
        )
    for _ in range(60):
        learned=learner(train_x)
        learned_loss,_,_,_=train_detail.fidelity_loss(
            learned,train_y,nn.L1Loss(),gradient_weight=.35
        )
        learner_opt.zero_grad(set_to_none=True)
        learned_loss.backward()
        torch.nn.utils.clip_grad_norm_(learner.parameters(),1.0)
        learner_opt.step()
    with torch.no_grad():
        final,final_colour,final_gx,final_gy=train_detail.fidelity_loss(
            learner(val_x),val_y,nn.L1Loss(),gradient_weight=.35
        )
        flat=learner(torch.full((1,3,16,16),.5))
    loss_improvement=float((initial-final)/initial)
    colour_improvement=float((initial_colour-final_colour)/initial_colour)
    initial_gradient=(initial_gx+initial_gy)*.5
    final_gradient=(final_gx+final_gy)*.5
    gradient_improvement=float((initial_gradient-final_gradient)/initial_gradient)
    if loss_improvement<.50 or colour_improvement<.50 or gradient_improvement<.50:
        raise AssertionError(
            "specialized CNN failed learnable-detail gate: "
            f"loss={loss_improvement:.3f}, colour={colour_improvement:.3f}, "
            f"gradient={gradient_improvement:.3f}"
        )
    if abs(float(flat.mean())-.5)>.05 or float(flat.std())>.05:
        raise AssertionError(
            f"trained CNN destabilized a flat field: mean={float(flat.mean()):.4f}, "
            f"std={float(flat.std()):.4f}"
        )

    # 6) Exported ONNX must preserve dynamic spatial dimensions and run on CPU ORT.
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

    print(
        "CNN training smoke test passed: identity, fidelity loss, gradients, "
        f"held-out learnable detail ({loss_improvement:.1%} loss / "
        f"{gradient_improvement:.1%} gradient improvement), validation gate and ONNX inference."
    )

if __name__=="__main__":
    main()
