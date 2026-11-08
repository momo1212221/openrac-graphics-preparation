# Specialized detail-CNN training

This directory is deliberately separate from the runtime mod. It prepares **user-owned or
appropriately licensed** high-resolution reference art into deterministic synthetic low/high pairs,
then trains a small same-resolution residual CNN that restores material detail without an adversarial
loss.

## Dataset

```bash
python -m pip install -r requirements-training.txt
python tools/training/prepare_dataset.py /path/to/reference-assets training-data
```

The split is source-image based (90/5/5) so patches from one image never leak across train and test.
Each 128×128 target patch receives a deterministic PS2-style degradation: 2×/4× reduction, mild blur,
palette pressure and re-expansion. Material labels are inferred conservatively from paths and stored
in `manifest.jsonl`.

No game/disc assets are bundled or downloaded by these tools.

## Train and export

```bash
python tools/training/train_detail.py training-data models/detail-metal.onnx --material metal --epochs 30
```

Repeat for `weapon`, `character`, `terrain`, `stone`, `fabric`, `organic`, `glass`,
`energy`, `sky` or `generic`. The exported ONNX model accepts RGB NCHW and returns the same
resolution. The loss is fidelity-oriented (colour + horizontal/vertical gradient consistency), not
GAN/adversarial, to reduce invented detail.

Training output is intentionally not committed automatically. Models need validation in Quality Lab
before they can be pinned, hashed and shipped by the release workflow.


## Validate before release

```bash
python tools/training/validate_detail.py training-data models/detail-metal.onnx --material metal \
  --output models/detail-metal.validation.json
```

The validator runs only held-out validation/test sources and compares the model against its degraded
input in both RGB L1 and gradient L1. A model is marked `release_candidate: true` only when both
error measures improve. The report includes the exact model SHA-256 for later release pinning.
