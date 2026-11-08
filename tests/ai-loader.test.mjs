import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

test('AI loader statically bundles both WebGPU and WASM without dynamic imports',()=>{
  const code=readFileSync(root+'src/ai-runtime.js','utf8');
  assert.match(code,/import \* as ortWasm from "\.\.\/vendor\/ort\.wasm\.bundle\.min\.mjs"/);
  assert.match(code,/import \* as ortGpu from "\.\.\/vendor\/ort\.webgpu\.bundle\.min\.mjs"/);
  assert.doesNotMatch(code,/import\s*\(/);
  assert.match(code,/executionProviders:\s*\["webgpu"\]/);
  assert.match(code,/executionProviders:\s*\["wasm"\]/);
});

test('WebGPU tries graph capture before plain GPU and only then CPU fallback',()=>{
  const code=readFileSync(root+'src/ai-runtime.js','utf8');
  assert.match(code,/enableGraphCapture:\s*capture/);
  assert.match(code,/gpuCaptureDisabledForRun = true/);
  assert.match(code,/backend:"webgpu-capture"/);
  assert.match(code,/backend:"webgpu"/);
  assert.match(code,/backend:"wasm"/);
});

test('AI runtime keeps reusable tile buffers and records timings',()=>{
  const code=readFileSync(root+'src/ai-runtime.js','utf8');
  assert.match(code,/const inputValues = new Float32Array\(3 \* MODEL_INPUT \* MODEL_INPUT\)/);
  assert.match(code,/fillFixedRgbTile\(/);
  assert.match(code,/elapsedMs:performance\.now\(\)-started/);
  assert.doesNotMatch(code,/rendered = document\.createElement\("canvas"\)/);
});
