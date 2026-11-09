import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

test('main UI exposes adaptive hardware utilization controls',()=>{
  const code=readFileSync(root+'ui/main.js','utf8');
  assert.match(code,/performanceMode:\s*"auto"/);
  assert.match(code,/AI hardware utilization/);
  assert.match(code,/Auto · benchmark hardware/);
  assert.match(code,/\["8","8 lanes · maximum"\]/);
  assert.match(code,/warmAi\(state\.aiBackend, state\.performanceMode\)/);
  assert.match(code,/performanceMode:\s*state\.performanceMode/);
});

test('cache selector supports larger persistent budgets',()=>{
  const code=readFileSync(root+'ui/main.js','utf8');
  assert.match(code,/\[15360, "15 GB"\]/);
  assert.match(code,/\[20480, "20 GB"\]/);
});
