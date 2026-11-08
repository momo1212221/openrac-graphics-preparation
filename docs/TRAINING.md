# Specialized detail-CNN training

The training tools are separate from the runtime mod. They prepare **user-owned or appropriately
licensed** high-resolution reference art into deterministic synthetic low/high pairs, train
same-resolution material-detail CNNs, validate them on held-out sources, and only then allow a model
to be promoted into the runtime registry.

No game/disc assets are bundled or downloaded by these tools.

## 1. Install training dependencies

```bash
python -m pip install -r requirements-training.txt
```

CUDA is selected automatically when available, then Apple MPS, then CPU.

## 2. Build a dataset

```bash
python tools/training/prepare_dataset.py /path/to/reference-assets training-data
```

The dataset builder now protects against common training leakage:

- the 90/5/5 train/validation/test split is based on the **source image content SHA-256**, not the
  filename, so duplicate files under different names cannot fall into different splits;
- exact duplicate source images are skipped by default;
- large images are sampled deterministically across the whole image instead of taking only the first
  top-left patches;
- every row records source SHA-256, material, split and patch coordinates;
- `dataset-summary.json` records split/material counts and the exact manifest SHA-256.

Use `--keep-duplicate-sources` only when duplicate weighting is intentional.

Each 128×128 target patch receives a deterministic PS2-style degradation: 2×/4× reduction, mild
blur, palette pressure and re-expansion. Material labels are inferred conservatively from paths.

## 3. Train one material

```bash
python tools/training/train_detail.py training-data training-output/detail-metal-candidate.onnx \
  --material metal --epochs 30 --augment
```

Training is fidelity-oriented: RGB L1 plus horizontal/vertical gradient consistency. There is no
GAN/adversarial loss.

The trainer supports:

- source-balanced sampling so one large source image cannot dominate the epoch;
- deterministic `--seed`;
- matched flip/rotation augmentation through `--augment`;
- validation after every epoch;
- learning-rate reduction on plateaus;
- best-weight retention;
- early stopping with `--patience`;
- an optimizer/model checkpoint after every epoch.

Resume an interrupted run:

```bash
python tools/training/train_detail.py training-data training-output/detail-metal-candidate.onnx \
  --material metal --epochs 30 --augment --resume \
  --checkpoint training-output/detail-metal.checkpoint.pt
```

The checkpoint verifies the material before restoring model and optimizer state.

## 4. Train the complete material suite

```bash
python tools/training/train_suite.py training-data training-output \
  --epochs 30 --augment --continue-on-error
```

This runs the supported material families one after another and validates each candidate. Materials
with no training data or no held-out validation/test data are skipped instead of being silently
promoted. Use `--resume` to continue existing per-material checkpoints.

A `training-suite-summary.json` is written with the outcome and validation improvements for every
material.

## 5. Validate before release

```bash
python tools/training/validate_detail.py training-data training-output/detail-metal-candidate.onnx \
  --material metal --output training-output/detail-metal.validation.json
```

Validation uses only held-out validation/test sources. It compares the candidate against the
degraded input in RGB L1 and gradient L1. The report records:

- exact model SHA-256 and byte size;
- exact dataset manifest SHA-256;
- held-out split counts and unique source count;
- aggregate before/after errors;
- the worst retained examples for inspection.

A model becomes `release_candidate: true` only when both requested improvement thresholds are met.
Thresholds can be made stricter with `--min-l1-improvement` and
`--min-gradient-improvement`.

## 6. Inspect visually

Numerical validation is necessary but not sufficient. Review candidate output in Quality Lab,
especially characters, UI-like art, thin linework, emissive materials and seamless surfaces. Reject
models that invent texture or damage the original art direction even when aggregate metrics improve.

## 7. Promote a validated model

```bash
python tools/training/promote_model.py \
  training-output/detail-metal-candidate.onnx \
  training-output/detail-metal.validation.json
```

Promotion verifies `release_candidate`, re-checks the exact model SHA-256, copies the model/report
into `models/`, and updates `models/specialized-models.json`. Promotion does **not** happen during
training or suite execution.

The normal package builder refuses any `detail-*.onnx` file that is not registered, hash-matched
and backed by a `release_candidate: true` validation report.
