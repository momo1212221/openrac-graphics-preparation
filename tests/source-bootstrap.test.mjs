import {test} from "node:test";
import assert from "node:assert/strict";
import {listTextureSources} from "../src/source-bootstrap.js";

const hashed={path:"Planets/Novalis/0123456789abcdef.png",size:123};

test("existing runtime dump skips native source bootstrap",async()=>{
  const calls=[];
  const controller={
    list:async(root)=>{calls.push(["list",root]);return [hashed]},
    service:async()=>{throw new Error("must not run")},
  };
  const result=await listTextureSources(controller,{services:["graphics-preparation"]});
  assert.deepEqual(result.files,[hashed]);
  assert.equal(result.seeded,null);
  assert.deepEqual(calls,[["list","dump"]]);
});

test("empty dump is seeded from extracted level textures then listed again",async()=>{
  let lists=0;
  const calls=[];
  const controller={
    list:async(root)=>{
      calls.push(["list",root]);
      lists++;
      return lists===1?[]:[{path:"Extracted/fedcba9876543210.png",size:456}];
    },
    service:async(operation,value)=>{
      calls.push(["service",operation,value]);
      return {sourceFiles:12,added:1,total:1};
    },
  };
  const result=await listTextureSources(controller,{services:["graphics-preparation"]});
  assert.equal(result.files.length,1);
  assert.equal(result.seeded.added,1);
  assert.equal(result.error,null);
  assert.deepEqual(calls,[
    ["list","dump"],
    ["service","textures.sources.prepare",{}],
    ["list","dump"],
  ]);
});

test("older launcher stays usable and reports bootstrap error without hiding the empty dump",async()=>{
  const controller={
    list:async()=>[],
    service:async()=>{throw new Error("Operation is not available to the graphics preparation mod")},
  };
  const result=await listTextureSources(controller,{services:["graphics-preparation"]});
  assert.deepEqual(result.files,[]);
  assert.equal(result.seeded,null);
  assert.match(result.error,/not available/);
});
