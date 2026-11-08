// SPDX-License-Identifier: GPL-3.0-or-later
import * as ort from "../vendor/ort.wasm.bundle.min.mjs";
import {restoreSourceDetail} from "./detail.js";

const SCALE = 4;
const TILE = 96;
const PAD = 8;
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
      // The stock OpenRAC page is a custom-scheme WebView. Keep ORT single-threaded and give it
      // the WASM bytes directly: no nested module import, worker bootstrap or external URL is needed.
      ort.env.wasm.numThreads = 1;
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

function imageDataTensor(imageData) {
  const {width, height, data} = imageData;
  const plane = width * height;
  const values = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    values[i] = data[i * 4] / 255;
    values[plane + i] = data[i * 4 + 1] / 255;
    values[plane * 2 + i] = data[i * 4 + 2] / 255;
  }
  return new ort.Tensor("float32", values, [1, 3, height, width]);
}

function tensorImageData(tensor) {
  const dims = tensor.dims.map(Number);
  if (dims.length !== 4 || dims[0] !== 1 || dims[1] !== 3) throw new Error("unexpected Real-ESRGAN output shape");
  const height = dims[2], width = dims[3], plane = width * height;
  const out = new ImageData(width, height);
  for (let i = 0; i < plane; i++) {
    out.data[i * 4] = Math.max(0, Math.min(255, Math.round(tensor.data[i] * 255)));
    out.data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(tensor.data[plane + i] * 255)));
    out.data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(tensor.data[plane * 2 + i] * 255)));
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

async function runTile(sourceCanvas, sourceX, sourceY, coreW, coreH, aiSession) {
  const readX = Math.max(0, sourceX - PAD);
  const readY = Math.max(0, sourceY - PAD);
  const readRight = Math.min(sourceCanvas.width, sourceX + coreW + PAD);
  const readBottom = Math.min(sourceCanvas.height, sourceY + coreH + PAD);
  const readW = readRight - readX;
  const readH = readBottom - readY;

  const tile = document.createElement("canvas");
  tile.width = readW;
  tile.height = readH;
  const tileCtx = tile.getContext("2d", {alpha: true, willReadFrequently: true});
  tileCtx.drawImage(sourceCanvas, readX, readY, readW, readH, 0, 0, readW, readH);
  const input = imageDataTensor(tileCtx.getImageData(0, 0, readW, readH));
  const outputs = await aiSession.run({[aiSession.inputNames[0]]: input});
  const outputData = tensorImageData(outputs[aiSession.outputNames[0]]);

  const rendered = document.createElement("canvas");
  rendered.width = outputData.width;
  rendered.height = outputData.height;
  rendered.getContext("2d").putImageData(outputData, 0, 0);
  return {
    rendered,
    cropX: (sourceX - readX) * SCALE,
    cropY: (sourceY - readY) * SCALE,
    cropW: coreW * SCALE,
    cropH: coreH * SCALE,
  };
}

export async function warmAi() {
  await session();
  return {model: "Real-ESRGAN x4plus ONNX", backend: "ONNX Runtime Web/WASM · embedded module"};
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

    const tilesX = Math.ceil(source.width / TILE);
    const tilesY = Math.ceil(source.height / TILE);
    const total = tilesX * tilesY;
    let done = 0;

    for (let y = 0; y < source.height; y += TILE) {
      for (let x = 0; x < source.width; x += TILE) {
        const coreW = Math.min(TILE, source.width - x);
        const coreH = Math.min(TILE, source.height - y);
        const tile = await runTile(source, x, y, coreW, coreH, aiSession);
        outputCtx.drawImage(
          tile.rendered,
          tile.cropX, tile.cropY, tile.cropW, tile.cropH,
          x * SCALE, y * SCALE, tile.cropW, tile.cropH,
        );
        onProgress(++done, total);
        await new Promise((resolve) => setTimeout(resolve, 0));
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
