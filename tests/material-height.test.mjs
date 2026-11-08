import {test} from "node:test";
import assert from "node:assert/strict";
import {deriveMultiScaleHeight,deriveHeightBands,mergeHeightBands,normalFromHeight,deriveHeightSurfaceMaps,MATERIAL_HEIGHT_PROFILES} from "../src/material-height.js";

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


test("height pipeline exposes independent coarse mid and micro stages before merge",()=>{
  const src=image(32,32,(x,y)=>{
    const broad=x<16?82:168;
    const mid=(Math.floor(x/4)+Math.floor(y/4))%2?18:-18;
    const micro=(x+y)%2?7:-7;
    const v=Math.max(0,Math.min(255,broad+mid+micro));
    return [v,v,v,255];
  });
  const bands=deriveHeightBands(src,"stone");
  assert.ok(bands.stats.coarse.meanAbs>0);
  assert.ok(bands.stats.mid.meanAbs>0);
  assert.ok(bands.stats.micro.meanAbs>0);
  assert.equal(bands.coarse.data.length,32*32*4);
  assert.equal(bands.mid.data.length,32*32*4);
  assert.equal(bands.micro.data.length,32*32*4);
  const merged=mergeHeightBands(src,bands,"stone");
  assert.ok(merged.stats.reliefRange>0.05);
});

test("normal AO roughness and curvature derive from merged height",()=>{
  const src=image(24,24,(x,y)=>{
    const ridge=Math.abs(x-12)<2?210:90+((x+y)%5)*4;
    return [ridge,ridge,ridge,255];
  });
  const bands=deriveHeightBands(src,"weapon");
  const merged=mergeHeightBands(src,bands,"weapon");
  const normal=normalFromHeight(src,merged.heightField,"weapon");
  const surface=deriveHeightSurfaceMaps(src,merged.heightField,"weapon",.34,{curvature:true});
  assert.equal(normal.data.length,24*24*4);
  assert.equal(surface.ao.data.length,24*24*4);
  assert.equal(surface.roughness.data.length,24*24*4);
  assert.equal(surface.curvature.data.length,24*24*4);
  assert.ok(surface.stats.meanAo<1);
  assert.ok(surface.stats.meanRoughness>=.34);
});

test("curvature stage can be disabled without changing required surface maps",()=>{
  const src=image(12,12,(x,y)=>[80+x*5,80+y*4,80,255]);
  const bands=deriveHeightBands(src,"generic");
  const merged=mergeHeightBands(src,bands,"generic");
  const surface=deriveHeightSurfaceMaps(src,merged.heightField,"generic",.58,{curvature:false});
  assert.equal(surface.curvature,null);
  assert.ok(surface.ao);
  assert.ok(surface.roughness);
});


test("transparent RGB outside the visible island cannot bend height or normals",()=>{
  const src=image(20,20,(x,y)=>{
    const visible=x>=4&&x<=15&&y>=4&&y<=15;
    if(visible)return [128,128,128,255];
    // Deliberately hostile hidden RGB must not leak into visible reconstruction.
    return [(x*37+y*11)%256,(x*13+y*29)%256,(x*7+y*53)%256,0];
  });
  const out=deriveMultiScaleHeight(src,"stone");
  const centre=(10*20+10)*4;
  const edge=(4*20+10)*4;
  assert.ok(out.stats.reliefRange<.001);
  for(const i of [centre,edge]){
    assert.ok(Math.abs(out.normal.data[i]-128)<=1);
    assert.ok(Math.abs(out.normal.data[i+1]-128)<=1);
    assert.ok(out.normal.data[i+2]>=254);
  }
});

test("surface AO ignores transparent neighbours at cutout edges",()=>{
  const src=image(16,16,(x,y)=>{
    const visible=x>=3&&x<=12&&y>=3&&y<=12;
    return visible?[120,120,120,255]:[0,0,0,0];
  });
  const bands=deriveHeightBands(src,"generic");
  const merged=mergeHeightBands(src,bands,"generic");
  const surface=deriveHeightSurfaceMaps(src,merged.heightField,"generic",.58,{curvature:true});
  const edge=(3*16+8)*4;
  assert.ok(surface.ao.data[edge]>=250);
  assert.ok(Math.abs(surface.roughness.data[edge]/255-.58)<.03);
});
