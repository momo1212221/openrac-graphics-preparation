import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

test('direct and 8x AI paths both feed reconstructed alpha fidelity into quality metrics',()=>{
  const source=readFileSync(root+'src/ai-runtime.js','utf8');
  const matches=source.match(/metrics\.alphaEdgeCoverageDiff=/g)||[];
  assert.ok(matches.length>=2,'expected alpha edge fidelity wiring in direct and 8x paths');
  assert.match(source,/reconstructAlphaEdges\(sourceData,finalData\)/);
  assert.match(source,/finalBytes=await imageDataPng\(finalData\)/);
});

test('strict quality policy gates alpha edge coverage at every tier',()=>{
  const source=readFileSync(root+'src/quality-policy.js','utf8');
  assert.match(source,/alphaEdgeCoverageDiff:3/);
  assert.match(source,/alphaEdgeCoverageDiff:2/);
  assert.match(source,/alphaEdgeCoverageDiff:1\.5/);
  assert.match(source,/alpha edge coverage/);
});
