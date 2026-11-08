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
  assert.match(code,/ortGpu\.env\.wasm\.wasmBinary\s*=\s*wasm/);
  assert.match(code,/ortGpu\.env\.wasm\.numThreads\s*=\s*1/);
  assert.match(code,/executionProviders:\s*\["webgpu"\]/);
  assert.match(code,/executionProviders:\s*\["wasm"\]/);
});

test('auto backend disables a failing WebGPU session and falls back to WASM',()=>{
  const code=readFileSync(root+'src/ai-runtime.js','utf8');
  assert.match(code,/gpuDisabledForRun = true/);
  assert.match(code,/runtime = await acquireSession\("wasm"\)/);
  assert.match(code,/preference === "auto"/);
});

test('AI runtime keeps the optimized reusable tile buffer path',()=>{
  const code=readFileSync(root+'src/ai-runtime.js','utf8');
  assert.match(code,/const inputValues = new Float32Array\(3 \* MODEL_INPUT \* MODEL_INPUT\)/);
  assert.match(code,/fillFixedRgbTile\(/);
  assert.match(code,/outputCtx\.putImageData\(tile,/);
  assert.doesNotMatch(code,/rendered = document\.createElement\("canvas"\)/);
});
