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
    'tools/training/validate_detail.py',
  ]){
    execFileSync('python3',['-m','py_compile',file],{cwd:root});
  }
  const training=readFileSync(root+'docs/TRAINING.md','utf8');
  assert.match(training,/user-owned|appropriately licensed/i);
  assert.match(training,/release_candidate/);
  assert.match(training,/SHA-256/);
  const packageTool=readFileSync(root+'tools/package.py','utf8');
  assert.doesNotMatch(packageTool,/training-data|detail-metal\.onnx/);
});
