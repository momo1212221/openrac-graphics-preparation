import {readFileSync,writeFileSync} from "node:fs";
import {fuseCnnOutputs} from "../../src/cnn-fusion.js";

const config=JSON.parse(readFileSync(process.argv[2],"utf8"));
const baseBytes=readFileSync(config.base);
const detailBytes=readFileSync(config.detail);
const expected=config.width*config.height*4;
if(baseBytes.length!==expected||detailBytes.length!==expected){
  throw new Error(`RGBA byte count mismatch; expected ${expected}`);
}
const base={width:config.width,height:config.height,data:new Uint8ClampedArray(baseBytes)};
const detail={width:config.width,height:config.height,data:new Uint8ClampedArray(detailBytes)};
const result=fuseCnnOutputs(base,detail,{quality:config.quality,material:config.material});
writeFileSync(config.output,Buffer.from(result.image.data));
console.log(JSON.stringify({
  agreement:result.agreement,
  confidence:result.confidence,
  detailPixels:result.detailPixels,
  rejectedPixels:result.rejectedPixels,
  consideredPixels:result.consideredPixels,
}));
