import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

test('batch export carries Quality Lab overrides and guard state into AI/cache options',()=>{
  const code=readFileSync(root+'ui/main.js','utf8');
  assert.match(code,/const override = qualityLab\?\.getOverride\(primary\.hash\) \|\| \{\}/);
  assert.match(code,/qualityGuard: state\.qualityGuard/);
  assert.match(code,/textureClassOverride: override\.textureClass \|\| null/);
  assert.match(code,/materialOverride: override\.material \|\| null/);
  assert.match(code,/textureClassOverride: cacheOptions\.textureClassOverride/);
  assert.match(code,/materialOverride: cacheOptions\.materialOverride/);
});
