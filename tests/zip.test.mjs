import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crc32, ZipStream} from '../src/zip.js';

test('crc32 matches the standard ZIP checksum vector',()=>{
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
});

test('ZipStream writes a valid stored ZIP shape and closes the launcher save',async()=>{
  const chunks=[];
  const ends=[];
  const controller={
    async saveWrite(token,bytes){assert.equal(token,9);chunks.push(new Uint8Array(bytes));},
    async saveEnd(token,keep){ends.push([token,keep]);return 'pack.zip';},
  };
  const zip=new ZipStream(controller,9);
  await zip.add('a.txt',new TextEncoder().encode('hello'));
  assert.equal(await zip.finish(),'pack.zip');
  const all=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));
  let at=0; for(const c of chunks){all.set(c,at);at+=c.length;}
  const dv=new DataView(all.buffer);
  assert.equal(dv.getUint32(0,true),0x04034b50);
  assert.equal(dv.getUint32(all.length-22,true),0x06054b50);
  assert.deepEqual(ends,[[9,true]]);
});
