import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

test('per-texture quality override controls batch detail quality and No-AI bypass',()=>{
 const code=readFileSync(root+'ui/main.js','utf8');
 assert.match(code,/effectiveDetailQuality = \["standard","high","max"\]\.includes\(override\.quality\)/);
 assert.match(code,/override\.quality === "no-ai"/);
 assert.match(code,/backend: "manual-no-ai"/);
 assert.match(code,/detailQuality: effectiveDetailQuality/);
});

test('Quality Lab exposes material-map preview and per-hash quality selection',()=>{
 const code=readFileSync(root+'ui/quality-lab.js','utf8');
 assert.match(code,/generateMaterialMapPngs/);
 assert.match(code,/\["normal","roughness","height","ao","emissive"\]/);
 assert.match(code,/\["no-ai","No AI"\]/);
 assert.match(code,/evaluateQuality/);
 assert.match(code,/\["Verdict",policy\.verdict\]/);
});
