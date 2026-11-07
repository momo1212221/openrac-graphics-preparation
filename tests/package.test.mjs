import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

test('manifest is compatible with the official mod-tool page and packaging is deterministic',()=>{
  const m=JSON.parse(readFileSync(root+'openrac-mod.json'));
  assert.equal(m.id,'graphics-preparation');
  assert.equal(m.tool.page,'ui/index.html');
  assert.equal('service' in m.tool,false);
  assert.ok(m.games.rac1.includes('pal'));
  assert.ok(readFileSync(root+m.tool.page,'utf8').includes('main.js'));
  execFileSync('python3',['tools/package.py'],{cwd:root});
  const first=readFileSync(root+'dist/SHA256SUMS','utf8');
  execFileSync('python3',['tools/package.py'],{cwd:root});
  assert.equal(readFileSync(root+'dist/SHA256SUMS','utf8'),first);
  assert.match(first,/graphics-preparation-0\.2\.0\.zip/);
  assert.match(first,/openrac-graphics-helper\.py/);
});
