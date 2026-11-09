import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));

test('new runtime effects require deliberate placement',()=>{
  const source=readFileSync(root+'ui/effects.js','utf8');
  const start=source.indexOf('addParticle(preset)');
  const end=source.indexOf('\n  render(){',start);
  const block=source.slice(start,end);
  assert.match(block,/placement:"unplaced"/);
  assert.doesNotMatch(block,/selectedPlacementInstance\(\)/);
});

test('numeric authoring fields do not coerce blank input to zero',()=>{
  const source=readFileSync(root+'ui/effects.js','utf8');
  assert.match(source,/input\.valueAsNumber/);
  assert.match(source,/!Number\.isFinite\(next\)/);
  assert.doesNotMatch(source,/type==="number"\?Number\(input\.value\)/);
});

test('baker UI targets the normal launcher and enforces stock limits',()=>{
 const source=readFileSync(root+'ui/effects.js','utf8');
 assert.match(source,/Enhanced Baker · stock launcher/); assert.match(source,/Maximum probes/); assert.match(source,/max:"512"/);
 assert.match(source,/Rays \/ probe/); assert.match(source,/Bounces/); assert.match(source,/bakerExportIssues/); assert.match(source,/exportBake\.disabled=bakerIssues\.length>0/);
});

test('bake area lights have explicit placement controls',()=>{
 const source=readFileSync(root+'ui/effects.js','utf8');
 assert.match(source,/Place at selected level instance/); assert.match(source,/Confirm X\/Y\/Z/); assert.match(source,/area\.placement="unplaced"/);
});

test('runtime effect picker includes smog',()=>{const source=readFileSync(root+'ui/effects.js','utf8');assert.match(source,/\["smog","Smog"\]/)});
