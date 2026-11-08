import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

test('0.4.0 package declares the bounded fork AI service and local fallback',()=>{
  const m=JSON.parse(readFileSync(root+'openrac-mod.json'));
  assert.equal(m.id,'graphics-preparation');
  assert.equal(m.version,'0.4.0');
  assert.equal(m.type,'script');
  assert.equal(m.tool.page,'ui/index.html');
  assert.equal(m.tool.service,'graphics-preparation');
  for(const game of ['rac1','rac2','rac3','rac4']) assert.ok(game in m.games);
  execFileSync('python3',['tools/package.py'],{cwd:root});
  const first=readFileSync(root+'dist/SHA256SUMS','utf8');
  execFileSync('python3',['tools/package.py'],{cwd:root});
  assert.equal(readFileSync(root+'dist/SHA256SUMS','utf8'),first);
  assert.match(first,/graphics-preparation-0\.4\.0\.zip/);
  const names=execFileSync('python3',['-c',"import zipfile; print('\\n'.join(zipfile.ZipFile('dist/graphics-preparation-0.4.0.zip').namelist()))"],{cwd:root,encoding:'utf8'});
  assert.match(names,/graphics-preparation\/src\/zip\.js/);
  assert.match(names,/graphics-preparation\/src\/upscale\.js/);
  assert.match(names,/graphics-preparation\/ui\/index\.html/);
});
