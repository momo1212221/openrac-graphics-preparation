// SPDX-License-Identifier: GPL-3.0-or-later
const encoder = new TextEncoder();
const UTF8 = 0x0800;
const METHOD_STORE = 0;
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const table = (() => {
  const out = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    out[n] = c >>> 0;
  }
  return out;
})();

export function crc32(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const view = (size) => {
  const bytes = new Uint8Array(size);
  return {bytes, data: new DataView(bytes.buffer)};
};
const u16 = (v, at, value) => v.data.setUint16(at, value, true);
const u32 = (v, at, value) => v.data.setUint32(at, value >>> 0, true);

function localHeader(name, crc, size) {
  const n = encoder.encode(name);
  const v = view(30 + n.length);
  u32(v, 0, 0x04034b50);
  u16(v, 4, 20);
  u16(v, 6, UTF8);
  u16(v, 8, METHOD_STORE);
  u16(v, 10, DOS_TIME);
  u16(v, 12, DOS_DATE);
  u32(v, 14, crc);
  u32(v, 18, size);
  u32(v, 22, size);
  u16(v, 26, n.length);
  u16(v, 28, 0);
  v.bytes.set(n, 30);
  return v.bytes;
}

function centralHeader(name, crc, size, offset) {
  const n = encoder.encode(name);
  const v = view(46 + n.length);
  u32(v, 0, 0x02014b50);
  u16(v, 4, 20);
  u16(v, 6, 20);
  u16(v, 8, UTF8);
  u16(v, 10, METHOD_STORE);
  u16(v, 12, DOS_TIME);
  u16(v, 14, DOS_DATE);
  u32(v, 16, crc);
  u32(v, 20, size);
  u32(v, 24, size);
  u16(v, 28, n.length);
  u16(v, 30, 0);
  u16(v, 32, 0);
  u16(v, 34, 0);
  u16(v, 36, 0);
  u32(v, 38, 0);
  u32(v, 42, offset);
  v.bytes.set(n, 46);
  return v.bytes;
}

function endRecord(count, centralSize, centralOffset) {
  const v = view(22);
  u32(v, 0, 0x06054b50);
  u16(v, 4, 0);
  u16(v, 6, 0);
  u16(v, 8, count);
  u16(v, 10, count);
  u32(v, 12, centralSize);
  u32(v, 16, centralOffset);
  u16(v, 20, 0);
  return v.bytes;
}

export class ZipStream {
  constructor(controller, token) {
    this.controller = controller;
    this.token = token;
    this.offset = 0;
    this.entries = [];
    this.closed = false;
  }

  async write(bytes) {
    if (!bytes.byteLength) return;
    await this.controller.saveWrite(this.token, bytes);
    this.offset += bytes.byteLength;
  }

  async add(name, value) {
    if (this.closed) throw new Error("ZIP is already closed");
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (this.entries.length >= 65535) throw new Error("too many files for one texture pack");
    if (bytes.byteLength > 0xffffffff || this.offset > 0xffffffff) throw new Error("texture pack is too large");
    const crc = crc32(bytes);
    const offset = this.offset;
    await this.write(localHeader(name, crc, bytes.byteLength));
    await this.write(bytes);
    this.entries.push({name, crc, size: bytes.byteLength, offset});
  }

  async finish() {
    if (this.closed) throw new Error("ZIP is already closed");
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      await this.write(centralHeader(entry.name, entry.crc, entry.size, entry.offset));
    }
    const centralSize = this.offset - centralOffset;
    await this.write(endRecord(this.entries.length, centralSize, centralOffset));
    this.closed = true;
    return this.controller.saveEnd(this.token, true);
  }

  async cancel() {
    if (this.closed) return;
    this.closed = true;
    await this.controller.saveEnd(this.token, false);
  }
}
