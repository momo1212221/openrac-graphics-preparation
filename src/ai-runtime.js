// SPDX-License-Identifier: GPL-3.0-or-later
import * as ort from "../vendor/ort.wasm.bundle.min.mjs";
import {restoreSourceDetail} from "./detail.js";
import {CORE, MODEL_INPUT, PAD, SCALE, fillFixedRgbTile} from "./ai-tile.js";

let sessionPromise;
let wasmPromise;
let modelPromise;

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

async function runtimeBytes() {
  if (!wasmPromise) {
    wasmPromise = fetch(new URL("../vendor/ort-wasm-simd-threaded.wasm", import.meta.url))
      .then((response) => {
        if (!response.ok) throw new Error(`ONNX WASM runtime could not be loaded (${response.status})`);
        return response.arrayBuffer();
      })
      .then((value) => new Uint8Array(value));
  }
  return wasmPromise;
}

async function modelBytes() {
  if (!modelPromise) {
    modelPromise = fetch(new URL("../models/realesrgan-x4plus.onnx", import.meta.url))
      .then((response) => {
        if (!response.ok) throw new Error(`AI model could not be loaded (${response.status})`);
        return response.arrayBuffer();
      })
      .then((value) => new Uint8Array(value));
  }
  return modelPromise;
}

async function session() {
  if (!sessionPromise) {
    sessionPromise = Promise.all([runtimeBytes(), modelBytes()]).then(async ([wasm, model]) => {
      // 0 lets ONNX Runtime choose the fastest safe thread count for this WebView.
      // It automatically falls back to one thread if SharedArrayBuffer / cross-origin
      // isolation is unavailable. The previous forced value of 1 disabled all WASM
      // multithreading even on machines that support it.
      ort.env.wasm.numThreads = 0;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmBinary = wasm;
      return ort.InferenceSession.create(model, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
        enableCpuMemArena: true,
        enableMemPattern: true,
      });
    });
  }
  return sessionPromise;
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

  // Convert only the useful 112x112 core (4x) instead of materialising the complete
  // padded 128x128 model output into a temporary canvas for every tile.
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

async function runTile(sourceData, sourceX, sourceY, coreW, coreH, aiSession, inputValues) {
  fillFixedRgbTile(sourceData, sourceX, sourceY, inputValues);
  const input = new ort.Tensor("float32", inputValues, [1, 3, MODEL_INPUT, MODEL_INPUT]);
  const outputs = await aiSession.run({[aiSession.inputNames[0]]: input});
  return croppedTensorImageData(outputs[aiSession.outputNames[0]], coreW, coreH);
}

export async function resetAiSession() {
  const current = sessionPromise;
  sessionPromise = undefined;
  if (!current) return;
  try {
    const value = await current;
    if (value && typeof value.release === "function") await value.release();
  } catch {
    // A failed session is exactly what we are resetting.
  }
}

let preflightDone = false;
export async function warmAi() {
  const aiSession = await session();
  if (!preflightDone) {
    const input = new ort.Tensor("float32", new Float32Array(3 * MODEL_INPUT * MODEL_INPUT), [1, 3, MODEL_INPUT, MODEL_INPUT]);
    const outputs = await aiSession.run({[aiSession.inputNames[0]]: input});
    const output = outputs[aiSession.outputNames[0]];
    const dims = output?.dims?.map(Number) ?? [];
    const expected = MODEL_INPUT * SCALE;
    if (dims.length !== 4 || dims[0] !== 1 || dims[1] !== 3 || dims[2] !== expected || dims[3] !== expected) {
      await resetAiSession();
      throw new Error(`AI preflight returned ${dims.join("x") || "no output"}; expected 1x3x${expected}x${expected}`);
    }
    preflightDone = true;
  }

  const threads = Number(ort.env.wasm.numThreads) || 1;
  return {
    model: "Real-ESRGAN x4plus ONNX",
    backend: `ONNX Runtime Web/WASM · ${threads} thread${threads === 1 ? "" : "s"} · fixed 128×128 tiles · optimized`,
    threads,
  };
}

export async function upscaleAiPng(buffer, options = {}, onProgress = () => {}) {
  const mode = ["faithful", "balanced", "enhanced"].includes(options.mode) ? options.mode : "balanced";
  const preserveMicrodetail = options.preserveMicrodetail !== false;
  const preserveStars = options.preserveStars !== false;
  const image = await imageFromBytes(buffer);
  try {
    const source = document.createElement("canvas");
    source.width = image.width;
    source.height = image.height;
    const sourceCtx = source.getContext("2d", {alpha: true, willReadFrequently: true});
    sourceCtx.drawImage(image, 0, 0);
    const sourceData = sourceCtx.getImageData(0, 0, source.width, source.height);

    const output = document.createElement("canvas");
    output.width = source.width * SCALE;
    output.height = source.height * SCALE;
    const outputCtx = output.getContext("2d", {alpha: true, willReadFrequently: true});
    const aiSession = await session();
    const inputValues = new Float32Array(3 * MODEL_INPUT * MODEL_INPUT);

    const tilesX = Math.ceil(source.width / CORE);
    const tilesY = Math.ceil(source.height / CORE);
    const total = tilesX * tilesY;
    let done = 0;

    for (let y = 0; y < source.height; y += CORE) {
      for (let x = 0; x < source.width; x += CORE) {
        const coreW = Math.min(CORE, source.width - x);
        const coreH = Math.min(CORE, source.height - y);
        const tile = await runTile(sourceData, x, y, coreW, coreH, aiSession, inputValues);
        outputCtx.putImageData(tile, x * SCALE, y * SCALE);
        onProgress(++done, total);

        // Yield often enough for progress/repaint, but not after every inference.
        // Four tiles keeps the UI responsive while avoiding hundreds of event-loop hops.
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
    return {bytes: await canvasPng(output), ...stats};
  } finally {
    if (typeof image.close === "function") image.close();
  }
}
