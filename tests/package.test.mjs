import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

test('0.5.2 is a stock OpenRAC mod with bundled ORT module and no custom launcher service',()=>{
  const m=JSON.parse(readFileSync(root+'openrac-mod.json'));
  assert.equal(m.id,'graphics-preparation');
  assert.equal(m.version,'0.5.2');
  assert.equal(m.type,'script');
  assert.deepEqual(m.tool,{page:'ui/index.html'});
  execFileSync('python3',['tools/package.py'],{cwd:root});
  const first=readFileSync(root+'dist/SHA256SUMS','utf8');
  execFileSync('python3',['tools/package.py'],{cwd:root});
  assert.equal(readFileSync(root+'dist/SHA256SUMS','utf8'),first);
  assert.match(first,/graphics-preparation-0\.5\.2\.zip/);
});
