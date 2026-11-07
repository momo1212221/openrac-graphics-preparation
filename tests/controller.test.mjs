import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ModController, OPERATIONS} from '../src/controller.js';
test('controller routes only declared operations without starting work on load', async()=>{
 const calls=[];const c=new ModController(async(...args)=>{calls.push(args);return {ok:true};});
 assert.deepEqual(calls,[]);await c.status();await c.enable(false);
 assert.deepEqual(calls,[['status'],['enable',{enabled:false}]]);
 for(const op of OPERATIONS) await c.action(op,{test:true});
 assert.equal(calls.length,OPERATIONS.length+2);
 assert.throws(()=>c.action('terminal.exec'),/Unsupported/);
 assert.throws(()=>c.enable('true'),TypeError);
});
