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
