// Runs graph.html's own data + the injected explain-panel script in Node with a tiny DOM
// stand-in, clicks the busiest file, Show impact, Health check and Ask, and prints what the
// panel showed as JSON. Used by test_explain_html.py.
//   node bridge/tests/panel_check.mjs <graph.html> [question]
import fs from "node:fs";
const html = fs.readFileSync(process.argv[2], "utf8");
const grab = (re) => { const m = html.match(re); if (!m) throw new Error("missing " + re); return m[1]; };
const RAW_NODES = JSON.parse(grab(/const RAW_NODES = (\[.*?\]);\n/s));
const RAW_EDGES = JSON.parse(grab(/const RAW_EDGES = (\[.*?\]);\n/s));
const block = html.split("<!--UA-EXPLAIN-START-->")[1].split("<!--UA-EXPLAIN-END-->")[0];
const scripts = [...block.matchAll(/<script>(.*?)<\/script>/gs)].map((m) => m[1]);
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this.className = ""; this._text = ""; this.value = ""; this.checked = false; }
  append(...k) { for (const c of k) this.children.push(typeof c === "string" ? new Text(c) : c); }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...k) { this.children = []; this.append(...k); }
  insertBefore(c) { this.children.push(c); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  remove() {}
  select() {}
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { this._text = v; this.children = []; }
  get nodeType() { return 1; }
}
class Text { constructor(t) { this.t = t; } get textContent() { return this.t; } get nodeType() { return 3; } }
const body = new El("body"); const sidebar = new El("div");
body.classList = { add() {}, remove() {} };
globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new Text(t), body, getElementById: () => sidebar, execCommand() {}, addEventListener() {}, querySelectorAll: () => [] };
globalThis.window = globalThis; globalThis.dispatchEvent = () => {}; globalThis.Event = class {};
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async () => {} } }, configurable: true });
let titles = 0; globalThis.nodesDS = { update: (arr) => { titles += arr.length; } };
globalThis.RAW_NODES = RAW_NODES; globalThis.RAW_EDGES = RAW_EDGES;
globalThis.focusNode = () => {}; globalThis.showInfo = () => {};
for (const s of scripts) (0, eval)(s.replace(/^window\./, "globalThis."));
const X = globalThis.__UA_EXPLAIN__;
const drawer = body.children.find((c) => c.attrs.id === "ua-drawer") || sidebar.children[0] || body.children[0];
const find = (el, pred, out = []) => { if (pred(el)) out.push(el); for (const c of el.children || []) find(c, pred, out); return out; };
const bar = body.children.find((c) => c.attrs && c.attrs.id === "ua-bar");
const buttons = find(bar, (e) => e.tag === "button");
const out = { nodes: RAW_NODES.length, edges: RAW_EDGES.length, tooltipsSet: titles, fileIds: Object.keys(X.fileIds).length };
const repeated = Object.keys(X.fileIds).filter((p) => p.endsWith("__init__.py"));
out.initFilesRecognised = repeated.length;
// click a busy file
const counts = {}; RAW_EDGES.forEach((e) => { counts[e.to] = (counts[e.to] || 0) + 1; });
const fileIdSet = new Set(Object.values(X.fileIds));
const busiest = RAW_NODES.filter((n) => fileIdSet.has(n.id)).sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))[0];
globalThis.showInfo(busiest.id);
const dr = body.children.find((c) => c.attrs && c.attrs.id === "ua-drawer") || sidebar.children.find((c) => c.attrs && c.attrs.id === "ua-drawer");
const drawerEl = dr || [...body.children, ...sidebar.children].find((c) => c.attrs && c.attrs.id === "ua-drawer");
out.clicked = busiest.label;
out.panelHeadings = find(drawerEl, (e) => e.tag === "h4").map((e) => e.textContent);
const impactBtn = find(drawerEl, (e) => e.tag === "button" && /Show impact/.test(e.textContent))[0];
impactBtn.listeners.click[0]();
out.impact = find(drawerEl, (e) => e.tag === "div" && /depend on this/.test(e._text + (e.children[0]?.textContent || "") + e.textContent)).map((e) => e.textContent).find((t) => /depend on this/.test(t) && t.length < 400);
out.prompt = find(drawerEl, (e) => e.tag === "textarea")[0].value.slice(0, 220);
buttons.find((b) => /Health/.test(b.textContent)).listeners.click[0]();
out.health = find(drawerEl, (e) => e.tag === "h4").map((e) => e.textContent);
out.topHubs = find(drawerEl, (e) => e.className === "ua-row").slice(0, 3).map((e) => e.textContent.slice(0, 80));
const input = find(bar, (e) => e.tag === "input")[0];
input.value = process.argv[3] || "where is the cache stored?";
input.listeners.keydown[0]({ key: "Enter" });
out.ask = find(drawerEl, (e) => e.className === "ua-row").slice(0, 5).map((e) => find(e, (x) => x.tag === "b")[0].textContent);
console.log(JSON.stringify(out, null, 1));
