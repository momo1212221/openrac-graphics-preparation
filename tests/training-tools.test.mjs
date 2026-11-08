import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

test('training tools compile and keep release validation separate from runtime packaging',()=>{
  for(const file of [
    'tools/training/prepare_dataset.py',
    'tools/training/train_detail.py',
    'tools/training/train_suite.py',
    'tools/training/test_runtime_models.py',
    'tools/training/validate_detail.py',
    'tools/training/promote_model.py',
  ]){
    execFileSync('python3',['-m','py_compile',file],{cwd:root});
  }

  const training=readFileSync(root+'docs/TRAINING.md','utf8');
  assert.match(training,/user-owned|appropriately licensed/i);
  assert.match(training,/release_candidate/);
  assert.match(training,/SHA-256/);
  assert.match(training,/--resume/);
  assert.match(training,/source-balanced/i);

  const datasetTool=readFileSync(root+'tools/training/prepare_dataset.py','utf8');
  assert.match(datasetTool,/split_for\(source_sha\)/);
  assert.match(datasetTool,/duplicate_sources_skipped/);
  assert.match(datasetTool,/dataset-summary\.json/);
  assert.match(datasetTool,/--base-model/);
  assert.match(datasetTool,/BaseCnnReconstructor/);
  assert.match(datasetTool,/base_model_sha256/);

  const validator=readFileSync(root+'tools/training/validate_detail.py','utf8');
  assert.match(validator,/dataset_input_pipeline/);
  assert.match(validator,/base_model_sha256/);
  assert.match(validator,/laplacian_improvement/);
  assert.match(validator,/min-laplacian-improvement/);

  const trainer=readFileSync(root+'tools/training/train_detail.py','utf8');
  assert.match(trainer,/--resume/);
  assert.match(trainer,/WeightedRandomSampler/);
  assert.match(trainer,/ReduceLROnPlateau/);
  assert.match(trainer,/best_validation_loss|best_validation_score/);
  assert.match(trainer,/ARCHITECTURE_VERSION=2/);
  assert.match(trainer,/CONTEXT_DILATIONS/);
  assert.match(trainer,/laplacian_weight/);
  assert.match(trainer,/padding=dilation/);
  assert.match(trainer,/scheduler\.state_dict/);
  assert.match(trainer,/dataset_manifest_sha256/);
  assert.match(trainer,/\.training\.json/);

  const runtimeTest=readFileSync(root+'tools/training/test_runtime_models.py','utf8');
  assert.match(runtimeTest,/edge_contrast_preserved/);
  assert.match(runtimeTest,/deterministic_cpu/);
  assert.match(runtimeTest,/raw_abs_max <= 4\.0/);

  const suite=readFileSync(root+'tools/training/train_suite.py','utf8');
  assert.match(suite,/validate_detail\.py/);
  assert.doesNotMatch(suite,/promote_model\.py/);

  const packageTool=readFileSync(root+'tools/package.py','utf8');
  assert.doesNotMatch(packageTool,/training-data/);
  assert.match(packageTool,/specialized-models\.json/);
  assert.match(packageTool,/release_candidate/);
  assert.match(packageTool,/base-cnn-reconstruction/);
  assert.match(packageTool,/PINNED_BASE_X4PLUS_SHA256/);
  assert.match(packageTool,/laplacian_improvement/);

  const promoteTool=readFileSync(root+'tools/training/promote_model.py','utf8');
  assert.match(promoteTool,/base-cnn-reconstruction/);
  assert.match(promoteTool,/PINNED_BASE_X4PLUS_SHA256/);
  assert.match(promoteTool,/laplacian_improvement/);
});
