import {copyFile, mkdir} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const src = resolve(root, "node_modules/onnxruntime-web/dist");
const out = resolve(root, "vendor");
await mkdir(out, {recursive:true});
for (const name of [
  "ort.wasm.min.mjs",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
]) {
  await copyFile(resolve(src, name), resolve(out, name));
  console.log("copied", name);
}
