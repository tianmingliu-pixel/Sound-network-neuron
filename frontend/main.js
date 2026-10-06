// NeuroSense v0.3 主程序
//   输入源（文件 / 视频 / 直播）→ WebSocket → 共享仓库 store → 各面板模块
//   布局与模块在 layout.js 中配置

import { InputManager } from "./audio-io.js";
import { store } from "./core/store.js";
import { Panel } from "./core/panel.js";
import { LAYOUT, REGISTRY } from "./layout.js";
import { pitch, setPitchPalette, setPitchRange, GROUPS, groupColor } from "./palette.js";

const $ = (id) => document.getElementById(id);
const ui = {
  file: $("file"), upload: $("upload"), play: $("play"), seek: $("seek"),
  cam: $("cam"), live: $("live"), time: $("time"), status: $("status"), msg: $("msg"),
  window: $("window"), videoMode: $("video-mode"), clear: $("clear"), export: $("export"),
  video: $("video"), workspace: $("workspace"),
};
const showMsg = (t) => { ui.msg.textContent = t; ui.msg.hidden = !t; };

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------
const hooks = {
  seek(t) { if (io.mode === "file") ui.video.currentTime = t; },
};
const panels = LAYOUT.map((cfg) => new Panel(ui.workspace, cfg, REGISTRY, { store, hooks }));
const broadcast = (method, ...args) => panels.forEach((p) => p.call(method, ...args));

// 视频画中画放在上方面板里（面板外壳不随模块切换而重建）
document.getElementById("panel-top").appendChild(ui.video);

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
let ws = null, lastStart = null, dropped = 0;

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    ui.status.textContent = "已连接";
    if (lastStart) ws.send(JSON.stringify(lastStart));
  };
  ws.onclose = () => { ui.status.textContent = "断开，重连中…"; setTimeout(connect, 1000); };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
}
const send = (o) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };

function handle(m) {
  switch (m.type) {
    case "ready":
      store.meta = m;
      ui.status.textContent = `分析中 · ${m.sr / 1000} kHz · ${m.channels} 声道`;
      broadcast("onReady", m);
      break;
    case "frame":
      store.addFrame(m);
      broadcast("onFrame", m);
      break;
    case "event":
      store.addNode(m.node, m.edges);
      broadcast("onEvent", m.node, m.edges);
      break;
    case "pca_ready":
      store.applyPca(m.coords);
      broadcast("onPca", m.coords);
      break;
    case "caption": store.addRecog("captions", m); break;
    case "sound": store.addRecog("sounds", m); break;
    case "bird": store.addRecog("birds", m); break;
    case "ai_status":
      store.ai = m;
      updateAiChip();
      break;
    case "graph":
      download(m);
      break;
    case "error":
      showMsg(m.message);
      break;
  }
}

function download(graph) {
  const blob = new Blob([JSON.stringify(graph)], { type: "application/json" });
  const a = document.createElement("a");
  const base = (io.mode === "live" ? "live" : io.fileName || "graph").replace(/\.[^.]+$/, "");
  a.href = URL.createObjectURL(blob);
  a.download = `${base}.graph.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------------------
// 输入源
// ---------------------------------------------------------------------------
const io = new InputManager({
  video: ui.video,
  onPcm: (buf) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 4 * 1024 * 1024) { dropped++; return; }
    ws.send(buf);
  },
  onStart: (info) => { lastStart = { type: "start", ...info }; send(lastStart); },
  onStop: () => {},
  onError: showMsg,
});

function clearAll() {
  store.clearGraph();
  store.clearFrames();
  store.clearRecog();
  broadcast("onClear");
  send({ type: "clear" });
}

async function refreshFiles(select) {
  const { files } = await (await fetch("/api/files")).json();
  ui.file.innerHTML = files.map((f) => `<option>${f.replace(/</g, "&lt;")}</option>`).join("");
  const pick = select ?? files[0];
  if (pick) { ui.file.value = pick; await loadFile(pick); }
}

async function loadFile(name) {
  showMsg("");
  clearAll();
  ui.play.textContent = "▶ 播放";
  ui.play.disabled = ui.seek.disabled = true;
  await io.useFile(`/media/${encodeURIComponent(name)}`, name);
}

ui.video.addEventListener("loadedmetadata", () => {
  document.body.dataset.hasvideo = ui.video.videoWidth > 0 ? "1" : "0";
  if (io.mode === "file") { store.duration = ui.video.duration || 0; store.title = io.fileName || ""; }
  if (io.mode === "file") {
    ui.play.disabled = ui.seek.disabled = false;
    ui.seek.max = ui.video.duration || 1;
  }
});
ui.video.addEventListener("pause", () => { if (io.mode === "file") ui.play.textContent = "▶ 播放"; });
ui.video.addEventListener("play", () => { ui.play.textContent = "❚❚ 暂停"; });

ui.file.onchange = () => loadFile(ui.file.value);
ui.play.onclick = async () => {
  await io.resume();
  if (io.mode !== "file") await loadFile(ui.file.value);
  if (ui.video.paused) ui.video.play(); else ui.video.pause();
};
ui.seek.oninput = () => { ui.video.currentTime = +ui.seek.value; };
// 上传：带进度；文件名由后端自动清洗；浏览器不支持的格式由后端自动转码
function uploadFile(f) {
  return new Promise((resolve) => {
    const fd = new FormData();
    fd.append("file", f);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) ui.status.textContent = `上传中 ${Math.round((e.loaded / e.total) * 100)}%`;
    };
    xhr.upload.onload = () => { ui.status.textContent = "处理中…（转码可能需要一会儿）"; };
    xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ error: `上传失败（${xhr.status}）` }); } };
    xhr.onerror = () => resolve({ error: "上传失败：网络错误" });
    xhr.send(fd);
  });
}

async function handleUpload(f) {
  if (!f) return;
  showMsg("");
  const res = await uploadFile(f);
  ui.status.textContent = "已连接";
  if (res.error) { showMsg(`「${f.name}」${res.error}`); return; }
  await refreshFiles(res.file);   // 先加载（加载会清空提示），再显示提示
  if (res.converted) showMsg(`「${f.name}」浏览器不支持，已自动转码为 ${res.file}`);
  else if (res.renamed) showMsg(`已上传。文件名含特殊字符，已改为「${res.file}」`);
}

ui.upload.onchange = async () => {
  const f = ui.upload.files[0];
  ui.upload.value = "";
  await handleUpload(f);
};

// 拖拽上传：把音频 / 视频文件拖到页面任意位置
addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dropping"); });
addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
addEventListener("drop", async (e) => {
  e.preventDefault();
  document.body.classList.remove("dropping");
  for (const f of e.dataTransfer?.files ?? []) await handleUpload(f);
});

// 浏览器解码失败 → 请求后端转码后自动加载
const tried = new Set();
io.onDecodeError = async (name) => {
  if (tried.has(name)) { showMsg(`「${name}」转码后仍无法播放，文件可能已损坏。`); return; }
  tried.add(name);
  showMsg(`浏览器无法解码「${name}」，正在自动转码…`);
  const res = await (await fetch("/api/convert", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: name }) })).json();
  if (res.error) { showMsg(`「${name}」无法解码，自动转码也失败：${res.error}`); return; }
  await refreshFiles(res.file);
  showMsg(`「${name}」浏览器无法解码，已自动转码为 ${res.file}，请再点一次播放`);
};

ui.live.onclick = async () => {
  if (io.mode === "live") {
    io.stopLive();
    document.body.dataset.hasvideo = "0";
    ui.live.textContent = "● 开始直播";
    ui.live.classList.remove("live-on");
    return;
  }
  showMsg("");
  clearAll();
  store.duration = 0;
  store.title = "直播";
  const info = await io.startLive({ camera: ui.cam.checked });
  if (!info) return;
  document.body.dataset.hasvideo = ui.cam.checked ? "1" : "0";
  ui.live.textContent = "■ 停止";
  ui.live.classList.add("live-on");
};

document.querySelectorAll("[data-source]").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("[data-source]").forEach((b) => b.classList.toggle("on", b === btn));
    const s = btn.dataset.source;
    $("src-file").hidden = s !== "file";
    $("src-live").hidden = s !== "live";
    if (s === "file" && io.mode === "live") ui.live.click();
    if (s === "live") ui.video.pause();
  };
});

// ---------------------------------------------------------------------------
// 音高色带与范围（所有面板通过 pitch.version 联动）
// ---------------------------------------------------------------------------
const rangeSel = $("range"), fmin = $("fmin"), fmax = $("fmax");
$("palette").onchange = (e) => setPitchPalette(e.target.value);
rangeSel.onchange = () => {
  const v = rangeSel.value;
  $("custom-range").hidden = v !== "custom";
  if (v === "auto") { pitch.mode = "auto"; autoRange(true); }
  else if (v === "custom") { pitch.mode = "custom"; applyCustom(); }
  else { pitch.mode = "fixed"; const [a, b] = v.split("-").map(Number); setPitchRange(a, b); pitch.version++; }
};
function applyCustom() {
  const a = +fmin.value, b = +fmax.value;
  if (a > 0 && b > a) {
    setPitchRange(a, b);
    pitch.version++;
    fmin.value = Math.round(pitch.min); fmax.value = Math.round(pitch.max); // 显示实际生效的范围
  }
}
fmin.onchange = fmax.onchange = applyCustom;

/** 自适应：取最近 30 秒有声帧的质心 5%–95% 分位，两端各留约 2 个半音余量 */
function autoRange(force = false) {
  if (pitch.mode !== "auto") return;
  const last = store.latest();
  if (!last) return;
  const c = store.window(last.t - 30, last.t).filter((f) => f.rms > 0.08).map((f) => f.centroid).sort((a, b) => a - b);
  if (c.length < 20) return;
  const lo = c[Math.floor(c.length * 0.05)] / 1.12, hi = c[Math.floor(c.length * 0.95)] * 1.12;
  // 变化小于约 1 个半音时不更新，避免颜色闪烁
  const moved = Math.abs(Math.log2(lo / pitch.min)) > 1 / 12 || Math.abs(Math.log2(hi / pitch.max)) > 1 / 12;
  if (force || moved) { setPitchRange(lo, hi); fmin.value = Math.round(pitch.min); fmax.value = Math.round(pitch.max); }
}
setInterval(autoRange, 1000);

ui.window.onchange = () => { store.settings.windowSec = +ui.window.value; broadcast("onSettings", store.settings); };
ui.videoMode.onchange = () => { document.body.dataset.video = ui.videoMode.value; };
ui.clear.onclick = clearAll;
ui.export.onclick = () => send({ type: "export" });

// ---------------------------------------------------------------------------
// 字幕区（固定在上方「声学映射网络」面板顶部居中）
//   有人说话：显示最近 3 句（最新一句最大），每句带语言标签
//   没人说话：显示等待状态或识别引擎状态（未安装 / 加载中），让字幕区始终可见
//   底部一行：当前声音类别 / 鸟种
// ---------------------------------------------------------------------------
const cc = document.createElement("div");
cc.className = "caption-dock";
cc.innerHTML = `
  <div class="cd-head"><span class="cd-title">字幕 · 人声识别</span><span class="cd-state"></span></div>
  <div class="cd-lines"></div>
  <div class="cc-chips"></div>`;
document.getElementById("panel-top").appendChild(cc);
const ccLines = cc.querySelector(".cd-lines"), ccChips = cc.querySelector(".cc-chips"), ccState = cc.querySelector(".cd-state");
let ccSig = "";
const escHtml = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function updateCaptions() {
  const t = store.time;
  // 最近 30 秒内、已经“开始”的字幕，取最后 3 句（识别有 2–5 s 延迟，结束后保留显示）
  const recent = store.captions.filter((c) => c.t <= t + 0.05 && t - c.t_end < 30).slice(-3);
  const snd = store.activeAt("sounds", t, 3.5);
  const bird = store.activeAt("birds", t, 3);
  const a = store.ai;
  const state = !a ? "连接中…" : a.disabled ? "识别已关闭" :
    a.speech?.startsWith("就绪") ? (recent.length ? "" : "等待人声…") : a.speech;
  const sig = `${recent.map((c) => c.t + c.text).join("|")}|${snd?.t}|${bird?.t}|${state}`;
  if (sig === ccSig) return;
  ccSig = sig;
  ccState.textContent = state;
  ccLines.innerHTML = recent.map((c, i) => {
    const latest = i === recent.length - 1 && t - c.t_end < 6;
    return `<div class="cd-line${latest ? " latest" : ""}"><span class="cc-lang">${escHtml(c.lang_name)}</span><span class="cc-text">${escHtml(c.text)}</span></div>`;
  }).join("");
  const chips = [];
  if (snd) for (const l of snd.labels.slice(0, 3)) {
    const gname = GROUPS[l.group]?.name ?? "其它";
    const prefix = gname === l.zh ? "" : `${escHtml(gname)} · `;
    chips.push(`<span class="chip" style="--c:${groupColor(l.group)}">${prefix}${escHtml(l.zh)} ${Math.round(l.score * 100)}%</span>`);
  }
  if (bird) {
    const b = bird.species[0];
    chips.push(`<span class="chip" style="--c:${groupColor("species")}">鸟种 · <i>${escHtml(b.sci)}</i> ${escHtml(b.common)} ${Math.round(b.conf * 100)}%</span>`);
  }
  ccChips.innerHTML = chips.join("");
}

$("cc").onclick = (e) => {
  cc.hidden = !cc.hidden;
  e.target.classList.toggle("on", !cc.hidden);
};

function updateAiChip() {
  const a = store.ai, chip = $("ai");
  if (!a) return;
  if (a.disabled) { chip.textContent = "识别 已关闭"; chip.dataset.state = "off"; chip.title = "服务以 --no-ai 启动"; return; }
  const ok = (st) => st && st.startsWith("就绪");
  const mark = (st) => (ok(st) ? "✓" : st && st.includes("加载") ? "…" : "✕");
  chip.textContent = `识别 字幕${mark(a.speech)} 声音${mark(a.sound)} 鸟种${mark(a.bird)}`;
  chip.dataset.state = ok(a.speech) && ok(a.sound) && ok(a.bird) ? "ok" : ok(a.speech) || ok(a.sound) ? "part" : "off";
  chip.title = `字幕：${a.speech}\n声音：${a.sound}\n鸟种：${a.bird}`;
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------
function animate(now) {
  requestAnimationFrame(animate);
  store.time = io.now();
  if (io.mode === "file") {
    const d = ui.video.duration || 0;
    ui.time.textContent = `${store.time.toFixed(2)} / ${d.toFixed(2)} s`;
    if (!ui.video.paused) ui.seek.value = store.time;
  } else if (io.mode === "live") {
    ui.time.textContent = `● 直播 ${store.time.toFixed(1)} s` + (dropped ? ` · 丢块 ${dropped}` : "");
  }
  for (const p of panels) p.module?.render(now);
  updateCaptions();
}

document.body.dataset.hasvideo = "0";
document.body.dataset.video = "pip";
connect();
refreshFiles();
requestAnimationFrame(animate);
