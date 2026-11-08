import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ModController} from '../src/controller.js';

test('controller exposes only documented OpenRAC mod-tool operations', async()=>{
  const calls=[];
  const c=new ModController(async(call,args={})=>{calls.push([call,args]);return call==='read'?new ArrayBuffer(2):null;});
  await c.info();
  await c.list('dump');
  await c.read('dump','Shared/0123456789abcdef.png');
  await c.storeGet('texture-preparation');
  await c.storeSet('texture-preparation',{scale:4});
  await c.saveStart('pack','zip');
  await c.saveWrite(7,new Uint8Array([1,2]));
  await c.saveEnd(7,true);
  assert.deepEqual(calls.map(x=>x[0]),['info','list','read','storeGet','storeSet','saveStart','saveWrite','saveEnd']);
  assert.ok(calls[6][1].bytes instanceof ArrayBuffer);
});
