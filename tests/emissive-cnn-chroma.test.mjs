import test from 'node:test';
import assert from 'node:assert/strict';
import {predictBuiltinEmissive} from '../src/emissive-builtin-cnn.js';
import {fuseEmissivePrediction} from '../src/emissive-cnn-fusion.js';

function fixture(lamp, solid=false) {
  const width=64, height=64, data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    const light=solid || (x>18&&x<45&&y>19&&y<45);
    data.set(light?[...lamp,255]:[40,38,32,255],i);
  }
  return {width,height,data};
}
function fuse(image,material='generic') {
  const heuristic={width:image.width,height:image.height,data:new Uint8ClampedArray(image.data.length)};
  const prediction=predictBuiltinEmissive(image);
  return fuseEmissivePrediction({source:image,heuristic,prediction,material,confidence:0.68});
}

for(const [label,colour] of [
  ['red beacon',[245,30,20]],
  ['blue energy core',[25,40,245]],
  ['warm lamp',[245,238,220]],
]) {
  test('experimentally trained CNN promotes local '+label+' without manually authored emission',()=>{
    const out=fuse(fixture(colour));
    assert.equal(out.report.status,'applied');
    assert.ok(out.emissivePixels>100,JSON.stringify(out.report));
    if(label!=='warm lamp')assert.ok(out.report.chromaPromotedPixels>100,JSON.stringify(out.report));
    assert.ok(out.report.chromaDensity < .27 || label==='warm lamp');
  });
}

test('CNN does not turn saturated green foliage into a light',()=>{
  const out=fuse(fixture([25,245,30]),'organic');
  assert.equal(out.emissivePixels,0,JSON.stringify(out.report));
});

test('large flat red paint is not promoted by the new chroma exception',()=>{
  const out=fuse(fixture([245,30,20],true),'generic');
  assert.equal(out.emissivePixels,0,JSON.stringify(out.report));
});

test('chroma exception does not bypass protection for organic surfaces',()=>{
  const out=fuse(fixture([245,30,20]),'organic');
  assert.equal(out.report.chromaPromotedPixels,0);
  assert.equal(out.emissivePixels,0);
});
