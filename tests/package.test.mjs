import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('manifest has a matching bounded service and packaging is deterministic',()=>{
 const m=JSON.parse(readFileSync(root+'openrac-mod.json'));
 assert.ok(['graphics-preparation','save-backup-sync'].includes(m.id));assert.equal(m.tool.service,m.id);assert.ok(m.games.rac1.includes('pal'));
 assert.ok(readFileSync(root+m.tool.page,'utf8').includes('main.js'));
 execFileSync('python3',['tools/package.py'],{cwd:root});const first=readFileSync(root+'dist/SHA256SUMS','utf8');
 execFileSync('python3',['tools/package.py'],{cwd:root});assert.equal(readFileSync(root+'dist/SHA256SUMS','utf8'),first);
});
