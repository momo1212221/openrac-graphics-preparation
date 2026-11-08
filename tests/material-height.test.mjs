import {test} from "node:test";
import assert from "node:assert/strict";
import {deriveMultiScaleHeight,MATERIAL_HEIGHT_PROFILES} from "../src/material-height.js";

const image=(w,h,fn)=>{
  const data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(fn(x,y),(y*w+x)*4);
  return {width:w,height:h,data};
};

test("flat albedo stays flat with forward tangent normals",()=>{
  const src=image(16,16,()=>[120,120,120,255]);
  const out=deriveMultiScaleHeight(src,"stone");
  assert.ok(out.stats.reliefRange<.001);
  const i=(8*16+8)*4;
  assert.ok(Math.abs(out.normal.data[i]-128)<=1);
  assert.ok(Math.abs(out.normal.data[i+1]-128)<=1);
  assert.ok(out.normal.data[i+2]>=254);
});

test("stone reconstructs stronger relief than character from the same source structure",()=>{
  const src=image(32,32,(x,y)=>{
    const crack=(x===15||x===16||y===20)?45:130+((x+y)%4)*7;
    return [crack,crack,crack,255];
  });
  const stone=deriveMultiScaleHeight(src,"stone");
  const character=deriveMultiScaleHeight(src,"character");
  assert.ok(stone.stats.reliefRange>character.stats.reliefRange);
  assert.ok(MATERIAL_HEIGHT_PROFILES.stone.normalStrength>MATERIAL_HEIGHT_PROFILES.character.normalStrength);
});

test("fabric profile emphasizes micro detail while terrain emphasizes broad structure",()=>{
  assert.ok(MATERIAL_HEIGHT_PROFILES.fabric.micro>MATERIAL_HEIGHT_PROFILES.fabric.coarse);
  assert.ok(MATERIAL_HEIGHT_PROFILES.terrain.coarse>MATERIAL_HEIGHT_PROFILES.fabric.coarse);
});

test("transparent pixels keep neutral normals and do not affect visible stats",()=>{
  const src=image(8,8,(x,y)=>[100+x*4,100+y*4,100,(x+y)%2?255:0]);
  const out=deriveMultiScaleHeight(src,"metal");
  assert.equal(out.stats.visiblePixels,32);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)if((x+y)%2===0){
    const i=(y*8+x)*4;
    assert.equal(out.normal.data[i],128);
    assert.equal(out.normal.data[i+1],128);
    assert.equal(out.normal.data[i+2],255);
    assert.equal(out.normal.data[i+3],0);
  }
});
