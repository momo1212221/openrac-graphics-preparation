import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

test('AI loader avoids nested dynamic module imports in the OpenRAC WebView',()=>{
  const code=readFileSync(root+'src/ai-runtime.js','utf8');
  assert.match(code,/import \* as ort from "\.\.\/vendor\/ort\.wasm\.bundle\.min\.mjs"/);
  assert.doesNotMatch(code,/import\s*\(/);
  assert.match(code,/ort\.env\.wasm\.wasmBinary\s*=\s*wasm/);
  assert.match(code,/numThreads\s*=\s*1/);
  assert.match(code,/proxy\s*=\s*false/);
});
