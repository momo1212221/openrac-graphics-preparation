import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

test('effects runtime owns prop cleanup haze cleanup and emitter gravity',()=>{
  const source=readFileSync(root+'effects-runtime/src/mod.cpp','utf8');
  assert.match(source,/void clear_particles\(\)/);
  assert.match(source,/m_mod\.prop_remove\(p\.prop\)/);
  assert.match(source,/if \(level < 0\) m_mod\.haze_set\(\{\}\)/);
  assert.match(source,/p\.gravity = e\.gravity/);
  assert.match(source,/p\.velocity\[2\] \+= p\.gravity \* dt/);
  assert.doesNotMatch(source,/p\.velocity\[2\] -= 3\.5f \* dt/);
  assert.doesNotMatch(source,/e\.gravity \* 0\.02f/);
});

test('authored effects require the fixed native runtime generation',()=>{
  const manifest=JSON.parse(readFileSync(root+'effects-runtime/openrac-mod.json','utf8'));
  const authoring=readFileSync(root+'src/effects-authoring.js','utf8');
  assert.equal(manifest.version,'0.1.2');
  assert.match(authoring,/graphics-effects-runtime",version:">=0\.1\.2"/);
});
