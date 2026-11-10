import test from 'node:test';
import assert from 'node:assert/strict';
import {predictEmissiveEmbedded} from '../src/emissive-cnn-embedded.js';
const mk=(w,h,rgba)=>({width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>rgba[i%4])});
test('trained CNN produces finite, aligned probabilities',async()=>{
 const image=mk(35,37,[80,90,75,255]);
 const p=await predictEmissiveEmbedded(image);
 assert.deepEqual([p.width,p.height,p.probabilities.length],[35,37,1295]);
 assert.ok(p.probabilities.every(x=>Number.isFinite(x)&&x>=0&&x<=1));
});
test('white lamp probability beats uniform green foliage',async()=>{
 const image=mk(48,48,[10,210,15,255]);
 for(let y=20;y<28;y++)for(let x=20;x<28;x++)image.data.set([255,247,228,255],(y*48+x)*4);
 const p=await predictEmissiveEmbedded(image);
 assert.ok(p.probabilities[24*48+24] > p.probabilities[5*48+5]);
});
test('transparent texels are not marked emissive',async()=>{
 const image=mk(32,32,[255,255,255,0]),p=await predictEmissiveEmbedded(image);
 assert.ok(p.probabilities.every(v=>v===0));
});
test('large textures use bounded analysis resolution',async()=>{
 const img=mk(513,45,[200,190,180,255]);let calls=0;
 const p=await predictEmissiveEmbedded(img,{onProgress:()=>calls++});
 assert.ok(p.analysisWidth<=512&&p.analysisHeight<=512&&calls>0);
});
test('cancellation aborts without producing incomplete result',async()=>{
 await assert.rejects(predictEmissiveEmbedded(mk(8,8,[10,20,30,255]),{shouldCancel:()=>true}),/cancelled/);
});
