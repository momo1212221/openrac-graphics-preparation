// SPDX-License-Identifier: GPL-3.0-or-later
const pending = new Map(); let next = 0;
window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.openrac !== 1 || typeof event.data.ok !== "boolean") return;
  const item = pending.get(event.data.id); if (!item) return;
  clearTimeout(item.timer); pending.delete(event.data.id);
  event.data.ok ? item.resolve(event.data.value) : item.reject(new Error(event.data.error));
});
export function request(call, args = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Launcher did not answer. This mod requires the OpenRAC fork launcher 1.0.5 or newer.")); }, timeout);
    pending.set(id, {resolve, reject, timer});
    window.parent.postMessage({openrac:1, id, call, args}, "*");
  });
}
export const service = (operation, value = null) => request("service", {operation,value}, 30 * 60 * 1000);
