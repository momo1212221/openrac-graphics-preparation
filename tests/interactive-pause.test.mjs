import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

test('AI pause happens only after persisted group checkpoint',()=>{
  const code=readFileSync(root+'ui/main.js','utf8');
  const checkpoint=code.indexOf('await checkpointCurrentRun(group.members.map');
  const pause=code.indexOf('await pauseAtSafeBoundary(baseLabel)',checkpoint);
  assert.ok(checkpoint>=0);
  assert.ok(pause>checkpoint);
  assert.match(code,/dataset\.runControl = "1"/);
  assert.match(code,/current texture finishes first; pausing happens at the next safe checkpoint/i);
});

test('run completion releases any paused waiter and hides the control',()=>{
  const code=readFileSync(root+'ui/main.js','utf8');
  assert.match(code,/aiPauseGate\.reset\(\)/);
  assert.match(code,/pauseButton\.hidden = true/);
});
