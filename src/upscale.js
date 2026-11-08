// SPDX-License-Identifier: GPL-3.0-or-later
const MAX_SIDE = 8192;
const MAX_PIXELS = 64 * 1024 * 1024;

async function decode(bytes) {
  const blob = new Blob([bytes], {type: "image/png"});
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
}

function pngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("could not encode PNG")), "image/png");
  });
}

export async function upscalePng(buffer, scale, edgePreserving = true) {
  if (![2, 4].includes(scale)) throw new RangeError("scale must be 2 or 4");
  const image = await decode(buffer);
  try {
    const width = image.width * scale;
    const height = image.height * scale;
    if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
      throw new Error(`scaled texture would be too large (${width}x${height})`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", {alpha: true});
    if (!ctx) throw new Error("2D image processing is unavailable");
    ctx.imageSmoothingEnabled = !edgePreserving;
    if (!edgePreserving) ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return new Uint8Array(await (await pngBlob(canvas)).arrayBuffer());
  } finally {
    if (typeof image.close === "function") image.close();
  }
}
