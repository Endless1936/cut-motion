// Exercise browser playback scripts without depending on generated previews or local media.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../scripts/preview-mg-templates.mjs", import.meta.url), "utf8");
const browserScripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const inlineScript = file => browserScripts.find(script => script.includes(file === "index.html" ? "const frames=" : "window.ready=document.fonts.ready"));
const messages = [], events = new Map(), callbacks = new Map();
const frames = Array.from({ length: 13 }, () => ({ contentWindow: {
  get seek() { throw new Error("SecurityError: opaque file origin"); },
  postMessage(data, origin) { messages.push({ ...data, origin }); }
} }));
const slider = { value: "3.4" }, button = {}, readout = {};
let nextId = 0;
vm.runInNewContext(inlineScript("index.html"), {
  document: { querySelectorAll: () => frames, querySelector: selector => ({ "#time": slider, "#play": button, "#readout": readout })[selector] },
  window: { addEventListener: (type, handler) => events.set(type, handler) },
  location: { protocol: "file:", origin: "null" },
  performance: { now: () => 0 },
  requestAnimationFrame: callback => { callbacks.set(++nextId, callback); return nextId; },
  cancelAnimationFrame: id => callbacks.delete(id)
});
const tick = time => {
  const [id, callback] = callbacks.entries().next().value;
  callbacks.delete(id);
  callback(time);
};
assert.equal(messages.length, 13);
assert.ok(messages.every(message => message.origin === "*" && message.time === 3.4));
button.onclick();
assert.equal(button.textContent, "暂停");
assert.ok(messages.slice(-13).every(message => message.time === 0));
tick(1000);
assert.equal(readout.textContent, "1.00 s");
assert.ok(messages.slice(-13).every(message => message.time === 1));
slider.value = "5.2";
slider.oninput();
assert.equal(callbacks.size, 0);
assert.equal(button.textContent, "播放全部");
events.get("message")({ source: frames[0].contentWindow, data: { type: "mg-preview-ready" } });
assert.equal(messages.at(-1).time, 5.2, "late-loading frames receive the current time");
button.onclick();
button.onclick();
assert.equal(callbacks.size, 0, "pause cancels the running animation loop");
button.onclick();
assert.equal(callbacks.size, 1, "restart creates only one loop");
tick(8000);
assert.equal(readout.textContent, "8.00 s");
assert.equal(button.textContent, "播放全部");
assert.equal(callbacks.size, 0);

const childEvents = new Map(), seeks = [], parent = { postMessage() {} };
const childWindow = { parent, ready: Promise.resolve(), seek: time => seeks.push(time), addEventListener: (type, handler) => childEvents.set(type, handler) };
const childScript = inlineScript("ordered-steps.html");
vm.runInNewContext(childScript.slice(childScript.indexOf('window.addEventListener("message"')), {
  window: childWindow, location: { protocol: "file:", origin: "null" }
});
const receive = (source, time) => childEvents.get("message")({ source, data: { type: "mg-preview-seek", time } });
receive({}, 2);
receive(parent, NaN);
receive(parent, 2.5);
receive(parent, 20);
await Promise.resolve();
assert.deepEqual(seeks, [2.5, 8], "only valid parent messages seek the child timeline");
console.log("MG preview player tests passed: opaque origins, all-frame playback, scrubbing, readiness, pause and restart.");
