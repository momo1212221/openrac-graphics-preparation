import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOfflineEmissive} from '../src/emissive-offline.js';
const source={width:1,height:1,data:Uint8ClampedArray.from([255,255,230,255])};
const heuristic={width:1,height:1,data:Uint8ClampedArray.from([12,8,4,255])};
class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}}
const session={inputNames:['in'],outputNames:['out'],async run(){return {out:{dims:[1,1,128,128],data:new Float32Array(128*128).fill(1)}};}};

test('disabled neural stage does not invoke model or mutate heuristic',async()=>{
  const noRun={...session,async run(){throw Error('must not be called');}};
  const result=await prepareOfflineEmissive({source,heuristic,ort:{Tensor},session:noRun});
  assert.equal(result.report.status,'no-prediction');
  assert.deepEqual([...result.emissive.data],[12,8,4,255]);
});

test('enabled stage uses injected ONNX output to augment emissive output',async()=>{
  const result=await prepareOfflineEmissive({source,heuristic,enabled:true,material:'metal',ort:{Tensor},session});
  assert.equal(result.report.status,'applied');
  assert.equal(result.report.promotedPixels,1);
  assert.ok(result.emissive.data[0]>200);
});

test('model error falls back to existing emissive output with explicit warning',async()=>{
  const noRun={...session,async run(){throw Error('GPU provider failed');}};
  const result=await prepareOfflineEmissive({source,heuristic,enabled:true,ort:{Tensor},session:noRun});
  assert.equal(result.report.status,'inference-fallback');
  assert.match(result.report.warning,/GPU provider failed/);
  assert.deepEqual([...result.emissive.data],[12,8,4,255]);
});
