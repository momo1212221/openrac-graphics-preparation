import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acceptSpecializedRefinement,normalizeSpecializedRegistry} from '../src/specialized-models.js';

test('specialized model registry accepts only pinned validated-looking entries',()=>{
  const good='a'.repeat(64);
  const r=normalizeSpecializedRegistry({version:1,models:{
    metal:{file:'detail-metal.onnx',sha256:good,validation:'detail-metal.validation.json'},
    bad:{file:'../escape.onnx',sha256:'nope',validation:'x'},
  }});
  assert.deepEqual(Object.keys(r.models),['metal']);
  assert.equal(r.models.metal.file,'detail-metal.onnx');
});

test('missing or incompatible registry fails open',()=>{
  assert.deepEqual(normalizeSpecializedRegistry(null),{version:1,models:{}});
  assert.deepEqual(normalizeSpecializedRegistry({version:2,models:{}}),{version:1,models:{}});
});

test('specialized refinement is accepted only inside strict QA guardrails',()=>{
  const base={score:80,hallucinationScore:20,colorDrift:5};
  assert.equal(acceptSpecializedRefinement(base,{score:79,hallucinationScore:23,colorDrift:7}),true);
  assert.equal(acceptSpecializedRefinement(base,{score:78.9,hallucinationScore:20,colorDrift:5}),false);
  assert.equal(acceptSpecializedRefinement(base,{score:82,hallucinationScore:24,colorDrift:5}),false);
  assert.equal(acceptSpecializedRefinement(base,{score:82,hallucinationScore:20,colorDrift:7.1}),false);
});
