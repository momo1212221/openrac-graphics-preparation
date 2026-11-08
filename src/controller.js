// SPDX-License-Identifier: GPL-3.0-or-later
/** Thin wrapper around OpenRAC's stock protocol-1 mod-tool API. */
const STORE_KEY=/^[a-z0-9_-]{1,64}$/;
export const validateStoreKey=(key)=>{
  const value=String(key??"");
  if(!STORE_KEY.test(value)){
    throw new TypeError("invalid OpenRAC store key: expected 1-64 characters from [a-z0-9_-]");
  }
  return value;
};

const bufferOf = (value) => {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  throw new TypeError("expected bytes");
};

export class ModController {
  constructor(request) {
    if (typeof request !== "function") throw new TypeError("request must be a function");
    this.request = request;
  }

  info() { return this.request("info"); }
  list(root) { return this.request("list", {root}); }
  read(root, path, start, length) {
    return this.request("read", {
      root,
      path,
      ...(start === undefined ? {} : {start}),
      ...(length === undefined ? {} : {length}),
    });
  }
  storeGet(key) { return this.request("storeGet", {key:validateStoreKey(key)}); }
  storeSet(key, value) { return this.request("storeSet", {key:validateStoreKey(key), value}); }
  saveStart(name, extension) { return this.request("saveStart", {name, extension}); }
  saveWrite(token, bytes) { return this.request("saveWrite", {token, bytes: bufferOf(bytes)}); }
  saveEnd(token, keep) { return this.request("saveEnd", {token, keep}); }
  close() { return this.request("close"); }
}
