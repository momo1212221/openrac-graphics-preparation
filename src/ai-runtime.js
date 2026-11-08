// SPDX-License-Identifier: GPL-3.0-or-later
import * as ortWasm from "../vendor/ort.wasm.bundle.min.mjs";
import * as ortGpu from "../vendor/ort.webgpu.bundle.min.mjs";
import {restoreSourceDetail} from "./detail.js";
import {CORE, MODEL_INPUT, PAD, SCALE, fillFixedRgbTile} from "./ai-tile.js";

let wasmSessionPromise;
let gpuSessionPromise;
let wasmBytesPromise;
let gpuBytesPromise;
let modelPromise;
let activeBackend = null;
let gpuDisabledForRun = false;
let lastGpuError = null;
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

async function modelBytes() {
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

async function createGpuSession() {
  if (!gpuSessionPromise) {
    gpuSessionPromise = Promise.all([gpuRuntimeBytes(), modelBytes()]).then(async ([wasm, model]) => {
      // The WebGPU bundle uses a WASM async bridge. Keep that bridge single-threaded so the
      // OpenRAC custom-scheme WebView never needs a worker/module bootstrap; actual inference
      // runs on WebGPU.
      ortGpu.env.wasm.numThreads = 1;
      ortGpu.env.wasm.proxy = false;
      ortGpu.env.wasm.wasmBinary = wasm;
      return ortGpu.InferenceSession.create(model, {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
        enableCpuMemArena: true,
        enableMemPattern: true,
      });
    });
  }
  return gpuSessionPromise;
}

async function acquireSession(preference = "auto") {
  if (preference === "wasm") {
    activeBackend = "wasm";
    return {ort:ortWasm, session:await createWasmSession(), backend:"wasm"};
  }

  if (preference === "webgpu") {
    if (!canUseWebGpu()) {
      throw new Error(lastGpuError
        ? `WebGPU is unavailable for this run: ${lastGpuError}`
        : "WebGPU is not exposed by this OpenRAC WebView");
    }
    try {
      const session = await createGpuSession();
      activeBackend = "webgpu";
      return {ort:ortGpu, session, backend:"webgpu"};
    } catch (error) {
      lastGpuError = error instanceof Error ? error.message : String(error);
      gpuDisabledForRun = true;
      throw error;
    }
  }

  if (canUseWebGpu()) {
    try {
      const session = await createGpuSession();
      activeBackend = "webgpu";
      return {ort:ortGpu, session, backend:"webgpu"};
    } catch (error) {
      lastGpuError = error instanceof Error ? error.message : String(error);
      gpuDisabledForRun = true;
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

function croppedTensorImageData(tensor, coreW, coreH) {
  const {width, height} = outputShape(tensor);
  const expected = MODEL_INPUT * SCALE;
  if (width !== expected || height !== expected) {
    throw new Error(`unexpected Real-ESRGAN output size ${width}x${height}; expected ${expected}x${expected}`);
  }

  const cropX = PAD * SCALE;
  const cropY = PAD * SCALE;
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

async function runTile(sourceData, sourceX, sourceY, coreW, coreH, runtime, inputValues) {
  fillFixedRgbTile(sourceData, sourceX, sourceY, inputValues);
  const input = new runtime.ort.Tensor("float32", inputValues, [1, 3, MODEL_INPUT, MODEL_INPUT]);
  const outputs = await runtime.session.run({[runtime.session.inputNames[0]]: input});
  return croppedTensorImageData(outputs[runtime.session.outputNames[0]], coreW, coreH);
}

async function releasePromise(promise) {
  if (!promise) return;
  try {
    const value = await promise;
    if (value && typeof value.release === "function") await value.release();
  } catch {
    // A failed session is exactly what reset is for.
  }
}

export async function resetAiSession() {
  if (activeBackend === "webgpu") {
    const current = gpuSessionPromise;
    gpuSessionPromise = undefined;
    gpuDisabledForRun = true;
    preflightKey = "";
    await releasePromise(current);
    return;
  }

  const current = wasmSessionPromise;
  wasmSessionPromise = undefined;
  preflightKey = "";
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
  let runtime = await acquireSession(preference);
  try {
    await preflight(runtime);
  } catch (error) {
    if (runtime.backend === "webgpu" && preference === "auto") {
      lastGpuError = error instanceof Error ? error.message : String(error);
      await resetAiSession();
      runtime = await acquireSession("wasm");
      await preflight(runtime);
    } else {
      throw error;
    }
  }

  if (runtime.backend === "webgpu") {
    return {
      model:"Real-ESRGAN x4plus ONNX",
      backend:"ONNX Runtime WebGPU · GPU acceleration",
      provider:"webgpu",
      webgpu:true,
      fallbackReason:null,
    };
  }

  const threads = Number(ortWasm.env.wasm.numThreads) || 1;
  return {
    model:"Real-ESRGAN x4plus ONNX",
    backend:`ONNX Runtime WASM · ${threads} thread${threads === 1 ? "" : "s"} · CPU fallback`,
    provider:"wasm",
    threads,
    webgpu:false,
    fallbackReason:lastGpuError,
  };
}

export async function upscaleAiPng(buffer, options = {}, onProgress = () => {}) {
  const mode = ["faithful", "balanced", "enhanced"].includes(options.mode) ? options.mode : "balanced";
  const preserveMicrodetail = options.preserveMicrodetail !== false;
  const preserveStars = options.preserveStars !== false;
  const backend = ["auto", "webgpu", "wasm"].includes(options.backend) ? options.backend : "auto";
  const image = await imageFromBytes(buffer);
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
    const runtime = await acquireSession(backend);
    const inputValues = new Float32Array(3 * MODEL_INPUT * MODEL_INPUT);

    const tilesX = Math.ceil(source.width / CORE);
    const tilesY = Math.ceil(source.height / CORE);
    const total = tilesX * tilesY;
    let done = 0;

    for (let y = 0; y < source.height; y += CORE) {
      for (let x = 0; x < source.width; x += CORE) {
        const coreW = Math.min(CORE, source.width - x);
        const coreH = Math.min(CORE, source.height - y);
        const tile = await runTile(sourceData, x, y, coreW, coreH, runtime, inputValues);
        outputCtx.putImageData(tile, x * SCALE, y * SCALE);
        onProgress(++done, total);
        if (done === total || done % 4 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }

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
    const stats = restoreSourceDetail(sourceData, outData, mode, preserveMicrodetail, preserveStars);
    outputCtx.putImageData(outData, 0, 0);
    return {bytes:await canvasPng(output), ...stats, backend:runtime.backend};
  } finally {
    if (typeof image.close === "function") image.close();
  }
}
