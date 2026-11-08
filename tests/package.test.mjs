import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

test('0.17.1 is one native OpenRAC graphics product with its tool page',()=>{
  const m=JSON.parse(readFileSync(root+'openrac-mod.json'));
  assert.equal(m.id,'graphics-preparation');
  assert.equal(m.version,'0.17.1');
  assert.equal(m.type,'native');
  assert.equal(m.api,'1.14');
  assert.equal(m.assets,'assets');
  assert.equal(m.scripts,undefined);
  assert.deepEqual(m.tool,{page:'ui/index.html'});
  execFileSync('python3',['tools/package.py'],{cwd:root});
  const first=readFileSync(root+'dist/SHA256SUMS','utf8');
  execFileSync('python3',['tools/package.py'],{cwd:root});
  assert.equal(readFileSync(root+'dist/SHA256SUMS','utf8'),first);
  assert.ok(first.includes('graphics-preparation-0.17.1.zip'));
});
