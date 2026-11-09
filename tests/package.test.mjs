import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

test('0.21.3 is one native OpenRAC graphics product with its tool page',()=>{
  const m=JSON.parse(readFileSync(root+'openrac-mod.json'));
  assert.equal(m.id,'graphics-preparation');
  assert.equal(m.version,'0.21.3');
  assert.equal(m.type,'native');
  assert.equal(m.api,'1.14');
  assert.equal(m.assets,'assets');
  assert.equal(m.scripts,undefined);
  assert.deepEqual(m.tool,{page:'ui/index.html',service:'graphics-preparation'});
  execFileSync('python3',['tools/package.py'],{cwd:root});
  const first=readFileSync(root+'dist/SHA256SUMS','utf8');
  execFileSync('python3',['tools/package.py'],{cwd:root});
  assert.equal(readFileSync(root+'dist/SHA256SUMS','utf8'),first);
  assert.ok(first.includes('graphics-preparation-0.21.3.zip'));
  const main=readFileSync(root+'ui/main.js','utf8');
  assert.ok(main.includes('import {listTextureSources} from "../src/source-bootstrap.js";'));
  assert.ok(main.includes('listTextureSources(controller, info)'));
  const packer=readFileSync(root+'tools/package.py','utf8');
  assert.ok(packer.includes('for folder in ["ui","src","vendor","models"]'));
  assert.ok(readFileSync(root+'src/source-bootstrap.js','utf8').includes('export async function listTextureSources'));
});


test('launcher-native release packaging emits every OpenRAC platform asset',()=>{
  const packer=readFileSync(root+'tools/package.py','utf8');
  const workflow=readFileSync(root+'.github/workflows/release.yml','utf8');
  assert.ok(packer.includes("platform_archive=out/f'{m[\"id\"]}-{m[\"version\"]}-{platform}.zip'"));
  for(const platform of ['linux-x86_64','linux-aarch64','macos-arm64','macos-x86_64','windows-x86_64']){
    assert.ok(workflow.includes('graphics-preparation-$VERSION-'+platform+'.zip'));
  }
  assert.ok(workflow.includes('Verify launcher platform assets'));
  assert.ok(workflow.includes('SHA256SUMS'));
});


test('production geometry helper is shipped with the release package',()=>{
  const packer=readFileSync(root+'tools/package.py','utf8');
  assert.ok(packer.includes('helper/openrac_graphics_helper.py'));
  assert.ok(packer.includes('helper/geometry_enhance.py'));
  assert.ok(packer.includes('GUIDE.md'));
});
