#!/usr/bin/env python3
"""Numerically smoke-test the bundled Real-ESRGAN ONNX models on deterministic synthetic inputs."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def input_hw(session: ort.InferenceSession) -> tuple[int, int]:
    shape = session.get_inputs()[0].shape
    if len(shape) != 4:
        raise AssertionError(f"expected NCHW input, got {shape}")
    h = int(shape[2]) if isinstance(shape[2], int) and shape[2] > 0 else 128
    w = int(shape[3]) if isinstance(shape[3], int) and shape[3] > 0 else 128
    return h, w


def patterns(h: int, w: int) -> dict[str, np.ndarray]:
    flat = np.full((1, 3, h, w), 0.5, dtype=np.float32)

    colour = np.empty((1, 3, h, w), dtype=np.float32)
    colour[:, 0] = 0.78
    colour[:, 1] = 0.24
    colour[:, 2] = 0.12

    edge = np.full((1, 3, h, w), 0.2, dtype=np.float32)
    edge[:, :, :, w // 2 :] = 0.8

    yy, xx = np.indices((h, w))
    checker_luma = np.where(((xx // 4 + yy // 4) % 2) == 0, 0.25, 0.75).astype(np.float32)
    checker = np.repeat(checker_luma[None, None], 3, axis=1)

    gradient_luma = np.linspace(0.1, 0.9, w, dtype=np.float32)[None, None, None, :]
    gradient = np.broadcast_to(gradient_luma, (1, 3, h, w)).copy()

    return {
        "flat": flat,
        "colour": colour,
        "edge": edge,
        "checker": checker,
        "gradient": gradient,
    }


def run_once(session: ort.InferenceSession, arr: np.ndarray) -> np.ndarray:
    name = session.get_inputs()[0].name
    outputs = session.run(None, {name: arr})
    if len(outputs) != 1:
        raise AssertionError(f"expected exactly one output tensor, got {len(outputs)}")
    out = np.asarray(outputs[0], dtype=np.float32)
    if out.ndim != 4 or out.shape[0] != 1 or out.shape[1] != 3:
        raise AssertionError(f"expected 1x3xHxW output, got {tuple(out.shape)}")
    if not np.isfinite(out).all():
        raise AssertionError("output contains NaN or Inf")
    return out


def model_report(model: Path) -> dict:
    session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    h, w = input_hw(session)
    test_inputs = patterns(h, w)
    outputs = {name: run_once(session, arr) for name, arr in test_inputs.items()}

    out_h, out_w = outputs["flat"].shape[2:]
    if out_h != h * 4 or out_w != w * 4:
        raise AssertionError(
            f"{model.name}: expected 4x output {w*4}x{h*4}, got {out_w}x{out_h}"
        )
    for name, out in outputs.items():
        if out.shape != outputs["flat"].shape:
            raise AssertionError(f"{model.name}: inconsistent output shape for {name}: {out.shape}")

    flat = outputs["flat"][0]
    flat_mean = flat.mean(axis=(1, 2))
    flat_error = float(np.abs(flat_mean - 0.5).mean())
    flat_spatial_std = float(flat.std(axis=(1, 2)).mean())

    colour = outputs["colour"][0]
    colour_expected = np.asarray([0.78, 0.24, 0.12], dtype=np.float32)
    colour_mean = colour.mean(axis=(1, 2))
    colour_error = float(np.abs(colour_mean - colour_expected).mean())

    edge = outputs["edge"][0].mean(axis=0)
    quarter = out_w // 4
    left_mean = float(edge[:, :quarter].mean())
    right_mean = float(edge[:, -quarter:].mean())
    edge_contrast = right_mean - left_mean

    checker_std = float(outputs["checker"][0].mean(axis=0).std())
    gradient = outputs["gradient"][0].mean(axis=0)
    gradient_left = float(gradient[:, :quarter].mean())
    gradient_right = float(gradient[:, -quarter:].mean())
    gradient_contrast = gradient_right - gradient_left

    repeat = run_once(session, test_inputs["flat"])
    determinism_max_abs = float(np.max(np.abs(repeat - outputs["flat"])))

    raw_min = min(float(out.min()) for out in outputs.values())
    raw_max = max(float(out.max()) for out in outputs.values())
    raw_abs_max = max(abs(raw_min), abs(raw_max))

    checks = {
        "finite": True,
        "scale_4x": True,
        "bounded_raw_output": raw_abs_max <= 4.0,
        "flat_mean_preserved": flat_error <= 0.18,
        "flat_region_stable": flat_spatial_std <= 0.12,
        "colour_mean_preserved": colour_error <= 0.24,
        "edge_contrast_preserved": edge_contrast >= 0.20,
        "checker_response_present": checker_std >= 0.04,
        "gradient_direction_preserved": gradient_contrast >= 0.20,
        "deterministic_cpu": determinism_max_abs <= 1e-5,
    }
    failed = [name for name, ok in checks.items() if not ok]

    return {
        "model": model.name,
        "sha256": sha256_file(model),
        "providers": session.get_providers(),
        "input_shape": [1, 3, h, w],
        "output_shape": list(outputs["flat"].shape),
        "metrics": {
            "flat_mean_rgb": [float(v) for v in flat_mean],
            "flat_mean_error": flat_error,
            "flat_spatial_std": flat_spatial_std,
            "colour_mean_rgb": [float(v) for v in colour_mean],
            "colour_mean_error": colour_error,
            "edge_left_mean": left_mean,
            "edge_right_mean": right_mean,
            "edge_contrast": edge_contrast,
            "checker_luma_std": checker_std,
            "gradient_left_mean": gradient_left,
            "gradient_right_mean": gradient_right,
            "gradient_contrast": gradient_contrast,
            "determinism_max_abs": determinism_max_abs,
            "raw_min": raw_min,
            "raw_max": raw_max,
        },
        "checks": checks,
        "failed_checks": failed,
        "ok": not failed,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("models", nargs="+", type=Path)
    ap.add_argument("--output", type=Path, default=Path("cnn-test-report.json"))
    args = ap.parse_args()

    report = {
        "version": 1,
        "purpose": "catastrophic ONNX runtime sanity checks; not a perceptual quality benchmark",
        "models": [],
    }
    failures = []
    for model in args.models:
        if not model.is_file():
            failures.append(f"missing model: {model}")
            continue
        try:
            row = model_report(model)
            report["models"].append(row)
            failures.extend(f"{model.name}: {name}" for name in row["failed_checks"])
        except Exception as exc:
            failures.append(f"{model.name}: {type(exc).__name__}: {exc}")

    report["ok"] = not failures
    report["failures"] = failures
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if failures:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
