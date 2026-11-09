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

test('native runtime parser is compiled and independently tested',()=>{
 const cmake=readFileSync(root+'CMakeLists.txt','utf8'); const parser=readFileSync(root+'effects-runtime/src/config.h','utf8'); const nativeTest=readFileSync(root+'effects-runtime/tests/config_test.cpp','utf8');
 assert.match(cmake,/graphics_effects_config_test/); assert.match(parser,/parse_emitter_line/); assert.match(parser,/preset=="smog"/); assert.match(nativeTest,/unknown/); assert.match(nativeTest,/2000000/);
});

test('effects export places object lights in the stock per-level asset root',()=>{
  const source=readFileSync(root+'src/effects-authoring.js','utf8');
  assert.match(source,/root\+"assets\/"\+level\.dir\+"\/object-lights\.json"/);
  assert.doesNotMatch(source,/root\+"object-lights\.json"/);
  assert.doesNotMatch(source,/root\+"assets\/object-lights\.json"/);
});

test('native runtime reads effects only from enabled plugins.json entries',()=>{
  const source=readFileSync(root+'effects-runtime/src/mod.cpp','utf8');
  const parser=readFileSync(root+'effects-runtime/src/plugin_list.h','utf8');
  assert.match(source,/parse_active_plugin_ids/);
  assert.doesNotMatch(source,/directory_iterator\(plugins/);
  assert.match(parser,/enabled/);
  assert.match(parser,/safe_plugin_id/);
});


test('native runtime filters authored effects to the running game and disc',()=>{
  const source=readFileSync(root+'effects-runtime/src/mod.cpp','utf8');
  const parser=readFileSync(root+'effects-runtime/src/plugin_list.h','utf8');
  assert.match(source,/effects_plugin_id\(mod\.game\(\), mod\.version\(\)\)/);
  assert.match(source,/if \(id != expected\) continue/);
  assert.match(parser,/graphics-effects-/);
});
