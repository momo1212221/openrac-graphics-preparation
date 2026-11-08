import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

test('manifest is compatible with OpenRAC 1.0.2 and newer mod-tool pages',()=>{
  const m=JSON.parse(readFileSync(root+'openrac-mod.json'));
  assert.equal(m.id,'graphics-preparation');
  assert.equal(m.version,'0.2.1');
  assert.equal(m.type,'script');
  assert.equal(m.api,'1.1');
  assert.deepEqual(m.scripts,['main.luau']);
  assert.equal(m.tool.page,'ui/index.html');
  assert.equal('service' in m.tool,false);
  assert.ok(m.games.rac1.includes('pal'));
  assert.ok(readFileSync(root+m.tool.page,'utf8').includes('main.js'));
  assert.match(readFileSync(root+'main.luau','utf8'),/compatibility entry point/i);
  execFileSync('python3',['tools/package.py'],{cwd:root});
  const first=readFileSync(root+'dist/SHA256SUMS','utf8');
  execFileSync('python3',['tools/package.py'],{cwd:root});
  assert.equal(readFileSync(root+'dist/SHA256SUMS','utf8'),first);
  assert.match(first,/graphics-preparation-0\.2\.1\.zip/);
  assert.match(first,/openrac-graphics-helper\.py/);
  const names=execFileSync('python3',['-c',"import zipfile; print('\\n'.join(zipfile.ZipFile('dist/graphics-preparation-0.2.1.zip').namelist()))"],{cwd:root,encoding:'utf8'});
  assert.match(names,/graphics-preparation\/main\.luau/);
  assert.match(names,/graphics-preparation\/ui\/index\.html/);
});
