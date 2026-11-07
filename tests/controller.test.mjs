import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ModController, JOB_OPERATIONS, JOB_KIND, RESULT_KIND} from '../src/controller.js';

test('controller uses only official mod-tool calls and creates portable jobs', async()=>{
  const calls=[];
  const c=new ModController(async(call,args={})=>{calls.push([call,args]);return {ok:true};});
  await c.info();
  await c.storeGet('preset');
  await c.storeSet('preset',{scale:4});
  assert.deepEqual(calls.map(x=>x[0]),['info','storeGet','storeSet']);
  const info={game:'rac1',version:'pal'};
  for(const op of JOB_OPERATIONS){
    const job=c.helperJob(op,info,{mode:'balanced'});
    assert.equal(job.kind,JOB_KIND);
    assert.equal(job.operation,op);
    assert.equal(job.game,'rac1');
  }
  assert.throws(()=>c.helperJob('terminal.exec',info),/Unsupported/);
});

test('helper result validation is bounded',()=>{
  const c=new ModController(()=>{});
  const result=c.parseResult({format:1,kind:RESULT_KIND,operation:'ai.textures',ok:true,output:'pack.zip'});
  assert.equal(result.ok,true);
  assert.throws(()=>c.parseResult({ok:true}),/Not a Graphics preparation helper result/);
});
