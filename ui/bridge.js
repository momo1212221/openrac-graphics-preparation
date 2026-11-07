// SPDX-License-Identifier: GPL-3.0-or-later
const pending = new Map();
let next = 0;

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.openrac !== 1 || typeof event.data.ok !== "boolean") return;
  const item = pending.get(event.data.id);
  if (!item) return;
  clearTimeout(item.timer);
  pending.delete(event.data.id);
  event.data.ok ? item.resolve(event.data.value) : item.reject(new Error(String(event.data.error ?? "Launcher request failed")));
});

/** Call only operations documented by OpenRAC's protocol-1 mod tool API. */
export function request(call, args = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("The OpenRAC launcher did not answer the mod-tool request."));
    }, timeout);
    pending.set(id, {resolve, reject, timer});
    const message = {openrac: 1, id, call, args};
    const transfer = args.bytes instanceof ArrayBuffer ? [args.bytes] : [];
    window.parent.postMessage(message, "*", transfer);
  });
}

export function encodeJson(value) {
  return new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n").buffer;
}

export function decodeJson(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}
