// SPDX-License-Identifier: GPL-3.0-or-later
import * as ortWasm from "../vendor/ort.wasm.bundle.min.mjs";
import * as ortGpu from "../vendor/ort.webgpu.bundle.min.mjs";
import {restoreSourceDetail} from "./detail.js";
import {MODEL_INPUT, SCALE, blendTile, fillFixedRgbTile, tileGeometry} from "./ai-tile.js";
import {trivialTexture} from "./ai-analyze.js";
import {classifyTexture} from "./texture-classify.js";
import {classifyMaterial} from "./material-classify.js";
import {fuseCnnOutputs} from "./cnn-fusion.js";
import {lockSourceChroma, qualityMetrics} from "./quality-metrics.js";
import {detectTextureWrap} from "./seam.js";
import {detectOutputFailures} from "./failure-detect.js";
import {resizePng,upscalePng} from "./upscale.js";

let wasmSessionPromise;
let gpuCaptureSessionPromise;
let gpuPlainSessionPromise;
let wasmBytesPromise;
let gpuBytesPromise;
let modelPromise;
let detailModelPromise;
const detailSessions={wasm:undefined,gpuCapture:undefined,gpuPlain:undefined};
let activeBackend = null;
let gpuDisabledForRun = false;
let gpuCaptureDisabledForRun = false;
let lastGpuError = null;
let lastGpuCaptureError = null;
let preflightKey = "";

const imageFromBytes = async (buffer) => {
  const blob = new Blob([buffer], {type: "image/png"});
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const canvasPng = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob(async (blob) => {
    if (!blob) return reject(new Error("could not encode AI texture PNG"));
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, "image/png");
});

const fetchBytes = (url, label) => fetch(url)
  .then((response) => {
    if (!response.ok) throw new Error(`${label} could not be loaded (${response.status})`);
    return response.arrayBuffer();
  })
  .then((value) => new Uint8Array(value));

async function wasmRuntimeBytes() {
  if (!wasmBytesPromise) {
    wasmBytesPromise = fetchBytes(
      new URL("../vendor/ort-wasm-simd-threaded.wasm", import.meta.url),
      "ONNX WASM runtime",
    );
  }
  return wasmBytesPromise;
}

async function gpuRuntimeBytes() {
  if (!gpuBytesPromise) {
    gpuBytesPromise = fetchBytes(
      new URL("../vendor/ort-wasm-simd-threaded.asyncify.wasm", import.meta.url),
      "ONNX WebGPU bridge",
    );
  }
  return gpuBytesPromise;
}

async function modelBytes(kind="base") {
  if(kind==="detail"){
    if(!detailModelPromise){
      detailModelPromise=fetchBytes(
        new URL("../models/realesrgan-general-x4v3.onnx",import.meta.url),
        "Detail/fidelity CNN model",
      );
    }
    return detailModelPromise;
  }
  if (!modelPromise) {
    modelPromise = fetchBytes(
      new URL("../models/realesrgan-x4plus.onnx", import.meta.url),
      "AI model",
    );
  }
  return modelPromise;
}

function canUseWebGpu() {
  return typeof navigator !== "undefined" && !!navigator.gpu && !gpuDisabledForRun;
}

async function createWasmSession() {
  if (!wasmSessionPromise) {
    wasmSessionPromise = Promise.all([wasmRuntimeBytes(), modelBytes()]).then(async ([wasm, model]) => {
      ortWasm.env.wasm.numThreads = 0;
      ortWasm.env.wasm.proxy = false;
      ortWasm.env.wasm.wasmBinary = wasm;
      return ortWasm.InferenceSession.create(model, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
        enableCpuMemArena: true,
        enableMemPattern: true,
      });
    });
  }
  return wasmSessionPromise;
}

async function gpuSessionOptions(capture) {
  const [wasm, model] = await Promise.all([gpuRuntimeBytes(), modelBytes()]);
  ortGpu.env.wasm.numThreads = 1;
  ortGpu.env.wasm.proxy = false;
  ortGpu.env.wasm.wasmBinary = wasm;
  const session = await ortGpu.InferenceSession.create(model, {
    executionProviders: ["webgpu"],
    graphOptimizationLevel: "all",
    enableGraphCapture: capture,
  });
  return session;
}

async function createGpuCaptureSession() {
  if (!gpuCaptureSessionPromise) gpuCaptureSessionPromise = gpuSessionOptions(true);
  return gpuCaptureSessionPromise;
}

async function createGpuPlainSession() {
  if (!gpuPlainSessionPromise) gpuPlainSessionPromise = gpuSessionOptions(false);
  return gpuPlainSessionPromise;
}

async function detailSessionFor(baseRuntime){
  if(baseRuntime.backend==="wasm"){
    if(!detailSessions.wasm){
      detailSessions.wasm=Promise.all([wasmRuntimeBytes(),modelBytes("detail")]).then(async([wasm,model])=>{
        ortWasm.env.wasm.numThreads=0;ortWasm.env.wasm.proxy=false;ortWasm.env.wasm.wasmBinary=wasm;
        return ortWasm.InferenceSession.create(model,{executionProviders:["wasm"],graphOptimizationLevel:"all"});
      });
    }
    return {ort:ortWasm,session:await detailSessions.wasm,backend:"wasm"};
  }
  if(baseRuntime.backend==="webgpu-capture"&&!gpuCaptureDisabledForRun){
    if(!detailSessions.gpuCapture){
      detailSessions.gpuCapture=Promise.all([gpuRuntimeBytes(),modelBytes("detail")]).then(async([wasm,model])=>{
        ortGpu.env.wasm.numThreads=1;ortGpu.env.wasm.proxy=false;ortGpu.env.wasm.wasmBinary=wasm;
        return ortGpu.InferenceSession.create(model,{executionProviders:["webgpu"],graphOptimizationLevel:"all",enableGraphCapture:true});
      });
    }
    try{return {ort:ortGpu,session:await detailSessions.gpuCapture,backend:"webgpu-capture"};}catch{}
  }
  if(!detailSessions.gpuPlain){
    detailSessions.gpuPlain=Promise.all([gpuRuntimeBytes(),modelBytes("detail")]).then(async([wasm,model])=>{
      ortGpu.env.wasm.numThreads=1;ortGpu.env.wasm.proxy=false;ortGpu.env.wasm.wasmBinary=wasm;
      return ortGpu.InferenceSession.create(model,{executionProviders:["webgpu"],graphOptimizationLevel:"all"});
    });
  }
  try{return {ort:ortGpu,session:await detailSessions.gpuPlain,backend:"webgpu"};}
  catch{return detailSessionFor({backend:"wasm"});}
}

async function acquireGpuSession() {
  if (!canUseWebGpu()) {
    throw new Error(lastGpuError
      ? `WebGPU is unavailable for this run: ${lastGpuError}`
      : "WebGPU is not exposed by this OpenRAC WebView");
  }

  if (!gpuCaptureDisabledForRun) {
    try {
      const session = await createGpuCaptureSession();
      activeBackend = "webgpu-capture";
      return {ort:ortGpu, session, backend:"webgpu-capture"};
    } catch (error) {
      lastGpuCaptureError = error instanceof Error ? error.message : String(error);
      gpuCaptureDisabledForRun = true;
    }
  }

  try {
    const session = await createGpuPlainSession();
    activeBackend = "webgpu";
    return {ort:ortGpu, session, backend:"webgpu"};
  } catch (error) {
    lastGpuError = error instanceof Error ? error.message : String(error);
    gpuDisabledForRun = true;
    throw error;
  }
}

async function acquireSession(preference = "auto") {
  if (preference === "wasm") {
    activeBackend = "wasm";
    return {ort:ortWasm, session:await createWasmSession(), backend:"wasm"};
  }

  if (preference === "webgpu") return acquireGpuSession();

  if (canUseWebGpu()) {
    try {
      return await acquireGpuSession();
    } catch {
      // Auto mode continues with WASM.
    }
  }

  activeBackend = "wasm";
  return {ort:ortWasm, session:await createWasmSession(), backend:"wasm"};
}

function outputShape(tensor) {
  const dims = tensor.dims.map(Number);
  if (dims.length !== 4 || dims[0] !== 1 || dims[1] !== 3) {
    throw new Error("unexpected Real-ESRGAN output shape");
  }
  return {height:dims[2], width:dims[3]};
}

function croppedTensorImageData(tensor, coreW, coreH, geometry) {
  const {width, height} = outputShape(tensor);
  const expected = MODEL_INPUT * SCALE;
  if (width !== expected || height !== expected) {
    throw new Error(`unexpected Real-ESRGAN output size ${width}x${height}; expected ${expected}x${expected}`);
  }

  const cropX = geometry.pad * SCALE;
  const cropY = geometry.pad * SCALE;
  const cropW = coreW * SCALE;
  const cropH = coreH * SCALE;
  const plane = width * height;
  const out = new ImageData(cropW, cropH);
  const dst = out.data;
  const src = tensor.data;
  let at = 0;

  for (let y = 0; y < cropH; y++) {
    let sourceAt = (cropY + y) * width + cropX;
    for (let x = 0; x < cropW; x++, sourceAt++, at += 4) {
      dst[at] = Math.max(0, Math.min(255, Math.round(src[sourceAt] * 255)));
      dst[at + 1] = Math.max(0, Math.min(255, Math.round(src[plane + sourceAt] * 255)));
      dst[at + 2] = Math.max(0, Math.min(255, Math.round(src[plane * 2 + sourceAt] * 255)));
      dst[at + 3] = 255;
    }
  }
  return out;
}

async function runTile(sourceData, sourceX, sourceY, coreW, coreH, runtime, inputValues, geometry, wrap) {
  fillFixedRgbTile(sourceData, sourceX, sourceY, inputValues, geometry.pad, wrap);
  const input = new runtime.ort.Tensor("float32", inputValues, [1, 3, MODEL_INPUT, MODEL_INPUT]);
  const outputs = await runtime.session.run({[runtime.session.inputNames[0]]: input});
  return croppedTensorImageData(outputs[runtime.session.outputNames[0]], coreW, coreH, geometry);
}

async function releasePromise(promise) {
  if (!promise) return;
  try {
    const value = await promise;
    if (value && typeof value.release === "function") await value.release();
  } catch {}
}

export async function resetAiSession() {
  preflightKey = "";

  if (activeBackend === "webgpu-capture") {
    const current = gpuCaptureSessionPromise;
    gpuCaptureSessionPromise = undefined;
    gpuCaptureDisabledForRun = true;
    await releasePromise(current);
    return;
  }

  if (activeBackend === "webgpu") {
    const current = gpuPlainSessionPromise;
    gpuPlainSessionPromise = undefined;
    gpuDisabledForRun = true;
    await releasePromise(current);
    return;
  }

  const current = wasmSessionPromise;
  wasmSessionPromise = undefined;
  await releasePromise(current);
}

async function preflight(runtime) {
  const key = runtime.backend;
  if (preflightKey === key) return;

  const input = new runtime.ort.Tensor(
    "float32",
    new Float32Array(3 * MODEL_INPUT * MODEL_INPUT),
    [1, 3, MODEL_INPUT, MODEL_INPUT],
  );
  const outputs = await runtime.session.run({[runtime.session.inputNames[0]]: input});
  const output = outputs[runtime.session.outputNames[0]];
  const dims = output?.dims?.map(Number) ?? [];
  const expected = MODEL_INPUT * SCALE;
  if (dims.length !== 4 || dims[0] !== 1 || dims[1] !== 3 || dims[2] !== expected || dims[3] !== expected) {
    throw new Error(`AI preflight returned ${dims.join("x") || "no output"}; expected 1x3x${expected}x${expected}`);
  }
  preflightKey = key;
}

export async function warmAi(preference = "auto") {
  // Capture -> plain WebGPU -> WASM in Auto mode. Each failed preflight removes only that layer.
  for (let attempt = 0; attempt < 3; attempt++) {
    let runtime;
    try {
      runtime = await acquireSession(preference);
      await preflight(runtime);

      if (runtime.backend === "webgpu-capture") {
        return {
          model:"Real-ESRGAN x4plus ONNX",
          backend:"ONNX Runtime WebGPU · GPU + graph capture",
          provider:"webgpu",
          graphCapture:true,
          webgpu:true,
          fallbackReason:null,
        };
      }
      if (runtime.backend === "webgpu") {
        return {
          model:"Real-ESRGAN x4plus ONNX",
          backend:"ONNX Runtime WebGPU · GPU",
          provider:"webgpu",
          graphCapture:false,
          webgpu:true,
          fallbackReason:lastGpuCaptureError,
        };
      }

      const threads = Number(ortWasm.env.wasm.numThreads) || 1;
      return {
        model:"Real-ESRGAN x4plus ONNX",
        backend:`ONNX Runtime WASM · ${threads} thread${threads === 1 ? "" : "s"} · CPU fallback`,
        provider:"wasm",
        threads,
        webgpu:false,
        graphCapture:false,
        fallbackReason:lastGpuError || lastGpuCaptureError,
      };
    } catch (error) {
      if (runtime?.backend === "webgpu-capture") {
        lastGpuCaptureError = error instanceof Error ? error.message : String(error);
        await resetAiSession();
        continue;
      }
      if (runtime?.backend === "webgpu") {
        lastGpuError = error instanceof Error ? error.message : String(error);
        await resetAiSession();
        if (preference === "webgpu") continue;
        continue;
      }
      throw error;
    }
  }
  throw new Error(lastGpuError || lastGpuCaptureError || "AI backend preflight failed");
}

export async function upscaleAiPng(buffer, options = {}, onProgress = () => {}) {
  const mode = ["faithful", "balanced", "enhanced"].includes(options.mode) ? options.mode : "balanced";
  const detailQuality = ["standard","high","max"].includes(options.detailQuality) ? options.detailQuality : "high";
  const detailCnn = options.detailCnn !== false;
  const sourceColorLock = options.sourceColorLock !== false;
  const preserveMicrodetail = options.preserveMicrodetail !== false;
  const preserveStars = options.preserveStars !== false;
  const backend = ["auto", "webgpu", "wasm"].includes(options.backend) ? options.backend : "auto";
  const image = await imageFromBytes(buffer);
  const started = performance.now();

  try {
    const source = document.createElement("canvas");
    source.width = image.width;
    source.height = image.height;
    const sourceCtx = source.getContext("2d", {alpha:true, willReadFrequently:true});
    sourceCtx.drawImage(image, 0, 0);
    const sourceData = sourceCtx.getImageData(0, 0, source.width, source.height);

    const output = document.createElement("canvas");
    output.width = source.width * SCALE;
    output.height = source.height * SCALE;
    const outputCtx = output.getContext("2d", {alpha:true, willReadFrequently:true});

    const classification = options.textureClassOverride
      ? {kind:options.textureClassOverride,confidence:1,reason:"manual override"}
      : classifyTexture(options.texturePaths || options.texturePath || "", sourceData);
    const textureClass = classification.kind;
    const materialInfo = options.materialOverride
      ? {material:options.materialOverride,confidence:1,reason:"manual override"}
      : classifyMaterial(options.texturePaths || options.texturePath || "", sourceData, textureClass);
    const material = materialInfo.material;
    const effectiveQuality = textureClass === "ui" ? "standard" : detailQuality;
    const wrap = detectTextureWrap(sourceData,{textureClass,material});

    const trivial = trivialTexture(sourceData);
    if (trivial.trivial) {
      outputCtx.imageSmoothingEnabled = false;
      outputCtx.clearRect(0, 0, output.width, output.height);
      outputCtx.drawImage(source, 0, 0, output.width, output.height);
      return {
        bytes:await canvasPng(output),
        stars:0,
        microdetails:0,
        backend:"trivial",
        skipped:true,
        skipReason:trivial.reason,
        textureClass,
        material,
        detailQuality:effectiveQuality,
        elapsedMs:performance.now()-started,
        tiles:0,
      };
    }

    if (textureClass === "normal" || textureClass === "mask") {
      outputCtx.imageSmoothingEnabled = true;
      outputCtx.imageSmoothingQuality = "high";
      outputCtx.drawImage(source,0,0,output.width,output.height);
      if (textureClass === "normal") {
        const technical = outputCtx.getImageData(0,0,output.width,output.height);
        for (let i=0;i<technical.data.length;i+=4) {
          let nx=technical.data[i]/127.5-1;
          let ny=technical.data[i+1]/127.5-1;
          let nz=technical.data[i+2]/127.5-1;
          const length=Math.hypot(nx,ny,nz)||1;
          nx/=length;ny/=length;nz/=length;
          technical.data[i]=Math.round((nx+1)*127.5);
          technical.data[i+1]=Math.round((ny+1)*127.5);
          technical.data[i+2]=Math.round((nz+1)*127.5);
        }
        outputCtx.putImageData(technical,0,0);
      }
      return {
        bytes:await canvasPng(output),
        stars:0,
        microdetails:0,
        backend:"technical",
        skipped:true,
        skipReason:textureClass,
        textureClass,
        material,
        detailQuality:"technical",
        elapsedMs:performance.now()-started,
        tiles:0,
      };
    }

    const geometry = tileGeometry(effectiveQuality, textureClass);
    const runtime = await acquireSession(backend);
    const detailRuntime = detailCnn && effectiveQuality !== "standard" && textureClass !== "ui"
      ? await detailSessionFor(runtime).catch(()=>null)
      : null;
    const inputValues = new Float32Array(3 * MODEL_INPUT * MODEL_INPUT);
    const detailInputValues = detailRuntime ? new Float32Array(3 * MODEL_INPUT * MODEL_INPUT) : null;
    let cnnAgreementSum=0,cnnConfidenceSum=0,cnnAgreementTiles=0,detailPixels=0,rejectedDetailPixels=0,consideredDetailPixels=0;
    const outputData = new ImageData(output.width, output.height);
    const weights = new Uint16Array(output.width * output.height);
    const xs=[]; for(let x=0;x<source.width;x+=geometry.step)xs.push(x);
    const ys=[]; for(let y=0;y<source.height;y+=geometry.step)ys.push(y);
    const total = xs.length * ys.length;
    let done = 0;

    for (const y of ys) {
      for (const x of xs) {
        const coreW = Math.min(geometry.core, source.width - x);
        const coreH = Math.min(geometry.core, source.height - y);
        let tile = await runTile(sourceData, x, y, coreW, coreH, runtime, inputValues, geometry, wrap);
        if(detailRuntime){
          try{
            const detailTile=await runTile(sourceData,x,y,coreW,coreH,detailRuntime,detailInputValues,geometry,wrap);
            const fused=fuseCnnOutputs(tile,detailTile,{quality:effectiveQuality,material});
            tile=fused.image;
            cnnAgreementSum+=fused.agreement;
            cnnConfidenceSum+=fused.confidence??fused.agreement;
            cnnAgreementTiles++;
            detailPixels+=fused.detailPixels;
            rejectedDetailPixels+=fused.rejectedPixels||0;\n            consideredDetailPixels+=fused.consideredPixels||0;
          }catch{
            // Detail CNN is optional; the x4plus result remains valid.
          }
        }
        blendTile(outputData, weights, tile, x*SCALE, y*SCALE, {
          overlap:geometry.overlap,
          sourceX:x,sourceY:y,
          sourceWidth:source.width,sourceHeight:source.height,
          coreW,coreH,
        });
        onProgress(++done,total);
        if(done===total||done%4===0)await new Promise((resolve)=>setTimeout(resolve,0));
      }
    }
    outputCtx.putImageData(outputData,0,0);

    const alpha = document.createElement("canvas");
    alpha.width = output.width;
    alpha.height = output.height;
    const alphaCtx = alpha.getContext("2d");
    alphaCtx.imageSmoothingEnabled = true;
    alphaCtx.imageSmoothingQuality = "high";
    alphaCtx.drawImage(source, 0, 0, alpha.width, alpha.height);
    outputCtx.save();
    outputCtx.globalCompositeOperation = "destination-in";
    outputCtx.drawImage(alpha, 0, 0);
    outputCtx.restore();

    const outData = outputCtx.getImageData(0, 0, output.width, output.height);
    const stats = restoreSourceDetail(sourceData, outData, mode, preserveMicrodetail, preserveStars, {
      detailQuality: effectiveQuality,
      textureClass,
      material,
    });
    if(sourceColorLock && textureClass!=="normal" && textureClass!=="mask"){
      lockSourceChroma(sourceData,outData,effectiveQuality==="max"?.82:.70);
    }
    const cnnRejectedRatio=consideredDetailPixels?rejectedDetailPixels/consideredDetailPixels:0;
    const metrics=qualityMetrics(sourceData,outData,{
      cnnAgreement:cnnAgreementTiles?cnnAgreementSum/cnnAgreementTiles:1,
      cnnConfidence:cnnAgreementTiles?cnnConfidenceSum/cnnAgreementTiles:1,
      cnnRejectedRatio,
    });
    if(wrap.x||wrap.y)metrics.expectSeamless=true;
    const failures=detectOutputFailures(sourceData,outData,metrics);
    outputCtx.putImageData(outData, 0, 0);
    return {
      bytes:await canvasPng(output),
      ...stats,
      backend:runtime.backend,
      textureClass,
      material,
      wrap,
      detailQuality:effectiveQuality,
      detailCnnUsed:!!detailRuntime,
      detailPixels,
      rejectedDetailPixels,
      consideredDetailPixels,
      cnnRejectedRatio,
      cnnConfidence:cnnAgreementTiles?cnnConfidenceSum/cnnAgreementTiles:1,
      metrics,
      failures,
      classification,
      materialInfo,
      elapsedMs:performance.now()-started,
      tiles:total,
    };
  } finally {
    if (typeof image.close === "function") image.close();
  }
}


function importantMasterPath(paths){
  const rows=(Array.isArray(paths)?paths:[paths]).filter(Boolean).map(String);
  return rows.some((p)=>/(ratchet|clank|character|hero|skin|weapon|wrench|blaster|gun|launcher|boss|enemy|terrain|rock|stone)/i.test(p));
}

async function decodedDimensions(buffer){
  const image=await imageFromBytes(buffer);
  try{return {width:image.width,height:image.height};}
  finally{if(typeof image.close==="function")image.close();}
}

async function imageDataFromPng(buffer){
  const image=await imageFromBytes(buffer);
  try{
    const canvas=document.createElement("canvas");
    canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext("2d",{alpha:true,willReadFrequently:true});
    if(!ctx)throw new Error("2D image processing is unavailable");
    ctx.drawImage(image,0,0);
    return ctx.getImageData(0,0,canvas.width,canvas.height);
  }finally{if(typeof image.close==="function")image.close();}
}

/**
 * Selective 8x internal master path.
 * Important small/medium assets are first expanded 2x, reconstructed 4x by the CNN (8x original),
 * then high-quality downsampled to the normal 4x pack size. This is intentionally opt-in/auto-selective.
 */
export async function upscaleAiMasterPng(buffer,options={},onProgress=()=>{}){
  const requested=options.master8x!==false;
  const detailQuality=["standard","high","max"].includes(options.detailQuality)?options.detailQuality:"high";
  const dims=await decodedDimensions(buffer);
  const eligible=requested&&detailQuality==="max"&&importantMasterPath(options.texturePaths||options.texturePath||"")&&
    dims.width*8<=8192&&dims.height*8<=8192&&dims.width*dims.height*64<=64*1024*1024;
  if(!eligible)return upscaleAiPng(buffer,options,onProgress);

  try{
    const source2x=await upscalePng(buffer,2,false);
    const master=await upscaleAiPng(source2x,{
      ...options,
      master8x:false,
      detailQuality:"max",
    },onProgress);
    const finalBytes=await resizePng(master.bytes,dims.width*4,dims.height*4,{smoothing:true});
    const [sourceData,finalData]=await Promise.all([imageDataFromPng(buffer),imageDataFromPng(finalBytes)]);
    const metrics=qualityMetrics(sourceData,finalData,{
      cnnAgreement:master.metrics?.cnnAgreement??1,
      cnnConfidence:master.metrics?.cnnConfidence??master.cnnConfidence??1,
      cnnRejectedRatio:master.metrics?.cnnRejectedRatio??master.cnnRejectedRatio??0,
    });
    if(master.wrap?.x||master.wrap?.y)metrics.expectSeamless=true;
    const failures=detectOutputFailures(sourceData,finalData,metrics);
    return {
      ...master,
      bytes:finalBytes,
      metrics,
      failures,
      masterScale:8,
      internalMaster:true,
      elapsedMs:master.elapsedMs,
    };
  }catch{
    const direct=await upscaleAiPng(buffer,options,onProgress);
    return {...direct,masterScale:4,internalMaster:false,masterFallback:true};
  }
}
