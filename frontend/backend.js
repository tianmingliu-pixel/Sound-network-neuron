// 后端地址：同一份前端既可以由本机后端直接提供（http://127.0.0.1:8000），
// 也可以放在 Vercel 上（https://….vercel.app），这时自动连接访问者自己电脑上的后端。
//
// 选择顺序（打开页面时执行一次）：
//   ① 手动设置过的地址（「后端」面板保存，或网址 ?api=…）
//   ② 本页面同一个地址（从 http://127.0.0.1:8000 打开时）
//   ③ 访问者自己电脑上的后端 http://127.0.0.1:8000
//   ④ 网站默认后端（config.js 里的 NEUROSENSE_API_BASE，默认为空）
// 音频分析、识别、上传的文件都在后端所在的电脑上，网页本身不做计算。

export const LOCAL = "http://127.0.0.1:8000";
export const REPO = "https://github.com/tianmingliu-pixel/Sound-network-neuron";
const KEY = "neurosense.api";
const SITE_DEFAULT = String(window.NEUROSENSE_API_BASE || "").replace(/\/+$/, "");

let base = "";
let source = "none";   // manual | same | local | remote | none

const clean = (v) => String(v ?? "").trim().replace(/\/+$/, "");
function readSaved() { try { return localStorage.getItem(KEY); } catch { return null; } }
export function saveBackend(v) {
  try { v == null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, clean(v)); } catch { /* 存储被禁用时忽略 */ }
}

/** 探测某个地址上是否有 NeuroSense 后端（1.5 秒超时） */
async function probe(b) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 1500);
  try {
    const r = await fetch(`${b}/api/files`, { signal: c.signal, cache: "no-store" });
    if (!r.ok) return false;
    const j = await r.json();
    return Array.isArray(j.files);
  } catch { return false; } finally { clearTimeout(t); }
}

export async function resolveBackend() {
  const q = new URLSearchParams(location.search).get("api");
  if (q != null) saveBackend(q);
  const saved = readSaved();
  if (saved != null) { base = clean(saved); source = "manual"; return; }
  if (location.protocol.startsWith("http") && await probe("")) { base = ""; source = "same"; return; }
  if (location.origin !== LOCAL && await probe(LOCAL)) { base = LOCAL; source = "local"; return; }
  base = SITE_DEFAULT;
  source = SITE_DEFAULT ? "remote" : "none";
}

export const apiBase = () => base;
export const backendSource = () => source;
export const hasBackend = () => source !== "none";
/** 后端上的路径 → 完整地址 */
export const api = (path) => base + path;
export function wsUrl() {
  const b = base || location.origin;
  return b.replace(/^http/, "ws") + "/ws";
}

// ---------------------------------------------------------------------------
// 「后端」面板：点击状态文字打开
// ---------------------------------------------------------------------------
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function mountBackendPanel(trigger) {
  const pop = document.createElement("div");
  pop.className = "backend-pop";
  pop.hidden = true;
  document.body.appendChild(pop);

  const where = () => ({
    manual: "手动设置的后端",
    same: "本页面（本机后端）",
    local: "你自己电脑上的后端",
    remote: "网站默认后端",
    none: "没有找到后端",
  })[source];

  function render() {
    pop.innerHTML = `
      <div class="bp-head"><b>后端连接</b><button class="btn ghost bp-x" type="button">✕</button></div>
      <p class="bp-now"><span>当前：</span> <span>${esc(where())}</span>${base ? ` <code translate="no">${esc(base)}</code>` : ""}</p>
      <label class="bp-field">后端地址
        <input class="bp-url" translate="no" value="${esc(base)}" placeholder="留空 = 与本页面同一个地址" />
      </label>
      <div class="bp-quick">
        <button class="btn ghost bp-local" type="button">本机 ${LOCAL}</button>
        <button class="btn ghost bp-auto" type="button">自动选择</button>
        <button class="btn bp-save" type="button">保存并重新连接</button>
      </div>
      <div class="bp-help">
        <p>这个网页只是界面；声音分析、字幕和识别都在你自己电脑上的 NeuroSense 后端里运行，音频和文件不会上传到网上。</p>
        <ol>
          <li>下载代码：<a href="${REPO}" target="_blank" rel="noreferrer">GitHub · Sound-network-neuron</a></li>
          <li>Windows 双击 <code>start.bat</code>；macOS / Linux 运行 <code>./start.sh</code></li>
          <li>回到本页刷新：网页会自动连接 <code translate="no">${LOCAL}</code></li>
        </ol>
        <p class="bp-note">Chrome / Edge 可能询问「是否允许访问本地网络上的设备」，请点「允许」。Safari 不允许网页连接本机后端，请改用 Chrome / Edge / Firefox，或直接打开 <a href="${LOCAL}" target="_blank" rel="noreferrer" translate="no">${LOCAL}</a>。</p>
      </div>`;
    const input = pop.querySelector(".bp-url");
    pop.querySelector(".bp-x").onclick = () => { pop.hidden = true; };
    pop.querySelector(".bp-local").onclick = () => { input.value = LOCAL; };
    pop.querySelector(".bp-auto").onclick = () => { saveBackend(null); location.href = location.pathname; };
    pop.querySelector(".bp-save").onclick = () => { saveBackend(input.value); location.reload(); };
  }

  trigger.style.cursor = "pointer";
  trigger.title = "点击设置后端地址";
  trigger.onclick = () => { render(); pop.hidden = !pop.hidden; };
  if (source === "none") { render(); pop.hidden = false; }   // 没有后端：直接告诉用户怎么启动
}
