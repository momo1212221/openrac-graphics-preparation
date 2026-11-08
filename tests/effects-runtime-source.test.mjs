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
});

test('same native runtime can identify as legacy runtime or unified graphics-preparation',()=>{
  const source=readFileSync(root+'effects-runtime/src/mod.cpp','utf8');
  const cmake=readFileSync(root+'CMakeLists.txt','utf8');
  const authoring=readFileSync(root+'src/effects-authoring.js','utf8');
  assert.match(source,/GRAPHICS_EFFECTS_MOD_ID/);
  assert.match(source,/GRAPHICS_EFFECTS_MOD_VERSION/);
  assert.match(cmake,/openrac_add_mod\(\s*graphics_preparation_runtime/);
  assert.match(cmake,/GRAPHICS_EFFECTS_MOD_ID="graphics-preparation"/);
  assert.match(authoring,/graphics-preparation",version:">=0\.17\.0"/);
  assert.doesNotMatch(authoring,/graphics-effects-runtime",version:/);
});
