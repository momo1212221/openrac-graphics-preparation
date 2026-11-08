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

For any specialized model intended for release, generate inputs from the same pinned x4plus model
used by the runtime. The simpler synthetic mode remains useful for experiments, but promotion and
packaging reject it:

```bash
python tools/training/prepare_dataset.py /path/to/reference-assets training-data \
  --base-model models/realesrgan-x4plus.onnx
```

In this mode each HR target patch is reduced to a PS2-like 4x-low-resolution source, padded into the
base model's real input tensor, reconstructed through x4plus, and cropped back to the target patch.
The specialized CNN therefore trains on the **actual base-CNN error distribution it will receive in
OpenRAC**, rather than only on bicubic re-expansion. The dataset summary and every row record the
base-model SHA-256.

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

Training is fidelity-oriented: RGB L1 plus horizontal/vertical gradient consistency and a small
Laplacian/high-frequency fidelity term. There is no GAN/adversarial or perceptual hallucination
loss.

Architecture v2 uses a deterministic 1/1/2/1/2/1/3/1 dilation cycle across residual blocks. Each
dilated 3×3 convolution uses matching dilation padding, so every residual block preserves exact
spatial dimensions. This increases material context without changing input/output resolution or the
identity-start safety property. Architecture-v1 checkpoints are intentionally rejected by `--resume` so an old model
cannot silently continue training under different convolution semantics.

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

The checkpoint verifies the material, architecture/dilation schedule, channel/block count, fidelity
weights and exact dataset-manifest SHA-256 before restoring model, optimizer and learning-rate
scheduler state. A resume with changed training data or incompatible hyperparameters is rejected
instead of silently continuing a different experiment.

Every completed export also writes a sibling `.training.json` provenance file with the ONNX
SHA-256, dataset-manifest SHA-256, architecture/configuration and best validation score.

## 4. Train the complete material suite

```bash
python tools/training/train_suite.py training-data training-output \
  --epochs 30 --augment --continue-on-error
```

This runs the supported material families one after another and validates each candidate. Materials
with no training data or no untouched **test** data are skipped instead of being silently promoted.
The validation split remains available for epoch/model selection; it is not sufficient for release. Use `--resume` to continue existing per-material checkpoints.

A `training-suite-summary.json` is written with the outcome and validation improvements for every
material.

## 5. Validate before release

```bash
python tools/training/validate_detail.py training-data training-output/detail-metal-candidate.onnx \
  --material metal --output training-output/detail-metal.validation.json
```

Release validation uses the untouched **test split only** for the authoritative pass/fail metrics.
The validation split is evaluated separately for diagnostics but never contributes to
`release_candidate`. This avoids tuning a model against the same data used for its final release
decision. The report compares the candidate against the degraded input in RGB L1, gradient L1 and
Laplacian L1 and records:

- exact model SHA-256 and byte size;
- exact dataset manifest SHA-256;
- training input pipeline and base-CNN SHA-256 when runtime-aligned inputs were used;
- held-out split counts plus separate validation/test sections and test-source count;
- aggregate before/after errors;
- the worst retained examples for inspection.

A model becomes `release_candidate: true` only when RGB L1, gradient L1 and Laplacian L1 all beat
their requested improvement thresholds. Thresholds can be made stricter with
`--min-l1-improvement`, `--min-gradient-improvement` and
`--min-laplacian-improvement`.

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

Promotion verifies `release_candidate`, re-checks the exact model SHA-256, requires validation
report v3+, requires the runtime-aligned input pipeline, verifies the training base-model SHA against
the pinned runtime x4plus SHA-256, and requires positive Laplacian improvement. It then copies the
model/report into `models/` and updates `models/specialized-models.json`. Promotion does **not**
happen during training or suite execution.

The normal package builder refuses any `detail-*.onnx` file that is not registered, hash-matched
and backed by a `release_candidate: true` validation report.


## Identity baseline and best-checkpoint selection

The specialized CNN now starts as an exact identity mapping: the final residual convolution is
zero-initialized, so epoch zero returns the degraded input unchanged instead of adding a random
residual.

When a validation split exists, that identity output is stored as the initial best candidate.
Each epoch is compared with the unchanged degraded input in both colour L1 and gradient L1. The
checkpoint selection score is the worse of the two relative error ratios, so a colour improvement
cannot hide degraded edge/detail fidelity. A trained checkpoint only beats the identity baseline
when both dimensions improve.

The training gradient weight is configurable:

```bash
python tools/training/train_detail.py training-data models/detail-stone-candidate.onnx \
  --material stone --epochs 40 --gradient-weight 0.35 --augment
```

The separate held-out validator is still authoritative for promotion. A candidate is never promoted
unless `validate_detail.py` reports positive RGB L1, gradient L1 and Laplacian L1 improvement and
marks `release_candidate: true`.

## Recommended real training sequence

1. Start with a single material family such as `stone` or `metal`.
2. Use user-owned or appropriately licensed high-resolution references from many independent source
   images, not patches from only a handful of originals.
3. Keep the source-image 90/5/5 split so validation/test patches never come from training sources.
4. Train with augmentation and source-balanced sampling.
5. Validate the exported ONNX model on held-out sources.
6. Inspect representative outputs in Quality Lab before promotion.
7. Promote only the SHA-validated model that passes all three fidelity metrics.
