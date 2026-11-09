import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ModController,validateStoreKey} from '../src/controller.js';

test('controller uses only stock OpenRAC protocol-1 calls', async()=>{
  const calls=[];
  const c=new ModController(async(call,args={})=>{calls.push([call,args]);return call==='read'?new ArrayBuffer(2):null;});
  await c.info();
  await c.service('ai.meshes',{mode:'enhanced',options:{profile:'modern'}});
  await c.list('dump');
  await c.read('dump','Shared/0123456789abcdef.png');
  await c.storeGet('texture-preparation');
  await c.storeSet('texture-preparation',{scale:4});
  await c.saveStart('pack','zip');
  await c.saveWrite(7,new Uint8Array([1,2]));
  await c.saveEnd(7,true);
  assert.deepEqual(calls.map(x=>x[0]),['info','service','list','read','storeGet','storeSet','saveStart','saveWrite','saveEnd']);
  assert.deepEqual(calls[1][1],{operation:'ai.meshes',value:{mode:'enhanced',options:{profile:'modern'}}});
  assert.ok(calls[7][1].bytes instanceof ArrayBuffer);
});


test('store keys follow the OpenRAC launcher contract', async()=>{
  assert.equal(validateStoreKey('texture-preparation-ai-run-v1-rac1-pal'),'texture-preparation-ai-run-v1-rac1-pal');
  assert.throws(()=>validateStoreKey('texture-preparation:bad'),/invalid OpenRAC store key/);
  assert.throws(()=>validateStoreKey('UPPERCASE'),/invalid OpenRAC store key/);
  assert.throws(()=>validateStoreKey('a'.repeat(65)),/invalid OpenRAC store key/);

  const calls=[];
  const c=new ModController(async(call,args={})=>{calls.push([call,args]);return null;});
  assert.throws(()=>c.storeSet('bad:key',{x:1}),/invalid OpenRAC store key/);
  assert.equal(calls.length,0);
});
