// 界面中英文切换。
//
// 做法：所有模块照常写中文，这里统一翻译显示出来的文字，模块代码不需要改：
//   1. 页面文字（DOM）：MutationObserver 监视文字节点和 title / aria-label / placeholder，
//      记住中文原文，按当前语言显示；切回中文时恢复原文。
//   2. 画布文字（2D canvas，包括 3D 场景里的文字贴图）：包装 fillText / strokeText / measureText。
//   3. 翻译：先整句查词典，查不到再把句中的已知片段逐个替换（片段两侧不能紧挨汉字，避免改动文件名等用户内容）。
// 带 translate="no" 的元素（文件列表、字幕原文）不翻译。
// 切换语言后会触发 "langchange" 事件，main.js 据此重建各面板（3D 文字贴图需要重画）。

import { UI, LANGS, AUDIOSET } from "./i18n-dict.js";

const STORE_KEY = "neurosense.lang";
const CJK = /[一-鿿]/;

function initialLang() {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v === "zh" || v === "en") return v;
  } catch { /* 浏览器禁用存储时忽略 */ }
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

export let lang = initialLang();

// ---------------- 词典与片段替换 ----------------
const DICT = { ...AUDIOSET };
try {
  const dn = new Intl.DisplayNames(["en"], { type: "language" });
  for (const [zh, code] of Object.entries(LANGS)) DICT[zh] = dn.of(code) || code;
} catch {
  for (const [zh, code] of Object.entries(LANGS)) DICT[zh] = code.toUpperCase();
}
Object.assign(DICT, UI);   // 界面词条优先

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEYS = Object.keys(DICT).sort((a, b) => b.length - a.length);
const FRAG = new RegExp(`(?<![\\u4e00-\\u9fff])(?:${KEYS.map(escRe).join("|")})(?![\\u4e00-\\u9fff])`, "g");
const PUNCT = [[/（/g, " ("], [/）/g, ")"], [/：/g, ": "], [/，/g, ", "], [/。/g, ". "], [/、/g, ", "],
               [/；/g, "; "], [/“|”/g, '"'], [/——/g, " — "], [/「/g, "“"], [/」/g, "”"]];

let cache = new Map();
let bypass = 0;

/** 把一段中文界面文字翻译成当前语言（中文模式原样返回） */
export function tr(s) {
  if (lang === "zh" || bypass || typeof s !== "string" || !CJK.test(s)) return s;
  let r = cache.get(s);
  if (r !== undefined) return r;
  const [, lead, core, tail] = s.match(/^(\s*)([\s\S]*?)(\s*)$/);   // 保留首尾空白
  r = DICT[core];
  if (r === undefined) {
    r = core.replace(FRAG, (m) => DICT[m]);
    if (!CJK.test(r)) {                         // 整句都译完了：全角标点换成英文标点
      for (const [re, to] of PUNCT) r = r.replace(re, to);
      r = r.replace(/ {2,}/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/ ([,.:;])/g, "$1").trim();
    }
  }
  r = lead + r + tail;
  if (cache.size > 5000) cache = new Map();
  cache.set(s, r);
  return r;
}

/** 在回调里暂停翻译（例如原样显示源代码） */
export function raw(fn) {
  bypass++;
  try { return fn(); } finally { bypass--; }
}

// ---------------- 画布文字 ----------------
const P = CanvasRenderingContext2D.prototype;
for (const m of ["fillText", "strokeText", "measureText"]) {
  const orig = P[m];
  P[m] = function (text, ...rest) { return orig.call(this, tr(text), ...rest); };
}

// ---------------- 页面文字 ----------------
const ATTRS = ["title", "aria-label", "placeholder"];
const origText = new WeakMap();   // 文字节点 → [中文原文, 上次写入的显示文字]
const origAttr = new WeakMap();   // 元素 → { 属性: [原文, 上次写入] }
const skip = (el) => !el || !!el.closest('[translate="no"], script, style');

function doText(n) {
  if (skip(n.parentElement)) return;
  const cur = n.nodeValue;
  let rec = origText.get(n);
  if (!rec || cur !== rec[1]) rec = [cur, cur];          // 新节点或被程序改过：当前内容就是原文
  const want = tr(rec[0]);
  rec[1] = want;
  origText.set(n, rec);
  if (cur !== want) n.nodeValue = want;
}

function doAttrs(el) {
  if (skip(el)) return;
  let recs = origAttr.get(el);
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const cur = el.getAttribute(a);
    recs ??= {};
    let rec = recs[a];
    if (!rec || cur !== rec[1]) rec = [cur, cur];
    const want = tr(rec[0]);
    rec[1] = want;
    recs[a] = rec;
    if (cur !== want) el.setAttribute(a, want);
  }
  if (recs) origAttr.set(el, recs);
}

function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return;
  doAttrs(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n);
}

let titleZh = document.title;
function applyAll() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = tr(titleZh);
  walk(document.body);
}

new MutationObserver((list) => {
  for (const m of list) {
    if (m.type === "characterData") doText(m.target);
    else if (m.type === "attributes") doAttrs(m.target);
    else for (const n of m.addedNodes) walk(n);
  }
}).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });

export function setLang(l) {
  if (l === lang || (l !== "zh" && l !== "en")) return;
  lang = l;
  cache = new Map();
  try { localStorage.setItem(STORE_KEY, l); } catch { /* 忽略 */ }
  applyAll();
  window.dispatchEvent(new CustomEvent("langchange", { detail: l }));
}

applyAll();
