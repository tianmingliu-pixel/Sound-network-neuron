// 代码 · 3D 执行视图：把“神经网络 · 实时训练”模块自己的源代码（train.js）放进 3D 空间，
// 与上方训练动画用同一条时间轴：
//   ① features() 特征 → ② forward() 前向 → ③ loss() 损失 → ④ 反向传播 → ⑤ Adam 更新 → ⑥ _evaluate() 验证
// 当前正在“执行”的代码卡片会被推到前面、点亮，执行光标逐行扫过；卡片标题显示这一刻的真实数值；
// 左下角滚动显示训练日志。代码是运行时从 train.js 读取的原文（行号与文件一致），不是示意图。

import * as THREE from "three";
import { ThreeModule } from "../core/three-base.js";
import { makeSprite } from "../palette.js";

const PHASES = [
  { key: "features", no: "①", title: "features(f) · 特征提取",   color: "#5ad1c8", start: /^function features\(/ },
  { key: "forward",  no: "②", title: "forward(x) · 前向传播",    color: "#7df9ff", start: /^ {2}forward\(x\) \{/ },
  { key: "loss",     no: "③", title: "loss(y, t) · 损失函数",    color: "#ffd166", start: /^ {2}loss\(y, t\) \{/ },
  { key: "backward", no: "④", title: "step() · 反向传播（梯度）", color: "#ff5cd6", start: /^ {2}step\(batch, lr\) \{/, until: /let gsq = 0/ },
  { key: "adam",     no: "⑤", title: "step() · Adam 更新权重",   color: "#ffaa5a", start: /let gsq = 0/, untilEndOf: "step" },
  { key: "evaluate", no: "⑥", title: "_evaluate() · 验证",       color: "#9be15d", start: /^ {2}_evaluate\(\) \{/ },
];
// 3D 位置：上排 ①②③ 从左到右，下排 ④⑤⑥ 从右到左 —— 形成一个执行环
const SLOTS = [[-6.2, 2.3], [0, 2.3], [6.2, 2.3], [6.2, -2.3], [0, -2.3], [-6.2, -2.3]];
// 光点沿环移动：每个阶段对应环上的一段（⑤ 结束后经过 ⑥ 回到 ①）
const SPAN = { features: [0, 1], forward: [1, 2], loss: [2, 3], backward: [3, 4], adam: [4, 6] };

const CW = 1000, CH = 600, LH = 31, VIEW = 15;   // 卡片画布尺寸、行高、可见行数
const FONT = "22px ui-monospace, 'Cascadia Mono', Consolas, 'Microsoft YaHei', monospace";
const KW = /^(const|let|for|if|else|return|new|of|function|class|this|continue|break)$/;

/** 从源文件里切出一个函数（按花括号配对） */
function extract(lines, ph) {
  let s = lines.findIndex((l) => ph.start.test(l));
  if (s < 0) return null;
  let e = s, depth = 0, seen = false;
  const stopAt = ph.until ? lines.findIndex((l, i) => i > s && ph.until.test(l)) : -1;
  if (stopAt > 0) e = stopAt - 1;
  else {
    let from = s;
    if (ph.untilEndOf) { from = lines.findIndex((l) => new RegExp(`^ {2}${ph.untilEndOf}\\(`).test(l)); depth = 0; }
    for (let i = from; i < lines.length; i++) {
      for (const ch of lines[i]) { if (ch === "{") { depth++; seen = true; } else if (ch === "}") depth--; }
      if (seen && depth <= 0) { e = i; break; }
    }
  }
  return { from: s, lines: lines.slice(s, e + 1) };
}

function tokens(line) {
  const out = [];
  const re = /(\/\/.*$)|("[^"]*"|`[^`]*`)|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1]) out.push([m[1], "#5f6b8f"]);
    else if (m[2]) out.push([m[2], "#9be15d"]);
    else if (m[3]) out.push([m[3], "#ffb86b"]);
    else if (m[4]) out.push([m[4], KW.test(m[4]) ? "#c792ea" : /^(Math|Float32Array)$/.test(m[4]) ? "#82aaff" : "#d6def8"]);
    else out.push([m[0], "#8a96c0"]);
  }
  return out;
}

class CodeCard {
  constructor(ph, src) {
    this.ph = ph; this.src = src;
    this.canvas = document.createElement("canvas");
    this.canvas.width = CW; this.canvas.height = CH;
    this.g = this.canvas.getContext("2d");
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const w = 5.6, h = (w * CH) / CW;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.sig = "";
    this.cursor = -1; this.top = 0;
  }

  draw(active, cursor, info) {
    const sig = `${active}|${cursor}|${info}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const g = this.g, L = this.src?.lines || [], ph = this.ph;
    g.clearRect(0, 0, CW, CH);
    // 背板
    g.fillStyle = active ? "rgba(10,16,34,0.92)" : "rgba(8,12,26,0.72)";
    g.strokeStyle = active ? ph.color : "rgba(120,140,200,0.35)";
    g.lineWidth = active ? 4 : 2;
    g.beginPath(); g.roundRect(3, 3, CW - 6, CH - 6, 18); g.fill(); g.stroke();
    // 标题
    g.textBaseline = "middle";
    g.font = "600 26px system-ui, 'Microsoft YaHei', sans-serif";
    g.fillStyle = active ? ph.color : "#8a96c0";
    g.fillText(`${ph.no} ${ph.title}`, 24, 34);
    g.font = "18px ui-monospace, Consolas, 'Microsoft YaHei', monospace";
    g.fillStyle = active ? "#e6ebff" : "#5f6b8f";
    g.fillText(info || "", 24, 66);
    g.fillStyle = "rgba(120,140,200,0.25)"; g.fillRect(20, 84, CW - 40, 1);
    if (!L.length) {
      g.fillStyle = "#8a96c0"; g.font = FONT; g.fillText("（读取源代码中…）", 24, 120);
      this.tex.needsUpdate = true; return;
    }
    // 滚动：光标保持在视口内
    if (cursor >= 0) {
      if (cursor < this.top + 2) this.top = Math.max(0, cursor - 2);
      if (cursor > this.top + VIEW - 4) this.top = Math.min(Math.max(0, L.length - VIEW), cursor - VIEW + 4);
    }
    g.font = FONT;
    const x0 = 86, maxW = CW - x0 - 24;
    for (let r = 0; r < VIEW && this.top + r < L.length; r++) {
      const i = this.top + r, y = 108 + r * LH;
      const hit = active && i === cursor;
      if (hit) {
        g.fillStyle = ph.color + "33"; g.fillRect(14, y - LH / 2, CW - 28, LH);
        g.fillStyle = ph.color; g.fillRect(14, y - LH / 2, 5, LH);
      }
      g.fillStyle = hit ? ph.color : "#3f4a6e";
      g.textAlign = "right"; g.fillText(String(this.src.from + i + 1), x0 - 16, y);
      g.textAlign = "left";
      let x = x0;
      for (const [t, c] of tokens(L[i].replace(/^ {2}/, ""))) {
        const w = g.measureText(t).width;
        if (x + w > x0 + maxW) { g.fillStyle = "#5f6b8f"; g.fillText("…", x, y); break; }
        g.fillStyle = active ? (hit ? "#ffffff" : c) : "#56607f";
        if (hit && c !== "#5f6b8f") g.fillStyle = c === "#d6def8" ? "#ffffff" : c;
        g.fillText(t, x, y); x += w;
      }
    }
    // 滚动条
    if (L.length > VIEW) {
      const h = (CH - 120) * (VIEW / L.length), y = 96 + (CH - 120) * (this.top / L.length);
      g.fillStyle = "rgba(120,140,200,0.3)"; g.fillRect(CW - 14, y, 4, h);
    }
    this.tex.needsUpdate = true;
  }
}

export class CodeViewModule extends ThreeModule {
  static title = "训练代码 · 3D 执行视图";

  constructor(ctx) {
    super({ body: ctx.body, pos: [0, 0.8, 14.5], target: [0, 0, 0], fov: 46, background: 0x05070f });
    this.store = ctx.store;
    this.body = ctx.body;
    this.controls.minAzimuthAngle = -0.9; this.controls.maxAzimuthAngle = 0.9;
    this.controls.minPolarAngle = 0.9; this.controls.maxPolarAngle = 2.2;

    ctx.tools.innerHTML = `<button class="btn ghost cv-sway on" title="缓慢摆动视角">⟳ 摆动</button>`;
    this.sway = true;
    const sw = ctx.tools.querySelector(".cv-sway");
    sw.onclick = () => { this.sway = !this.sway; sw.classList.toggle("on", this.sway); };

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.cards = PHASES.map((ph, i) => {
      const c = new CodeCard(ph, null);
      const [x, y] = SLOTS[i];
      c.base = new THREE.Vector3(x, y, -3.5 - Math.abs(x) * 0.32);
      c.baseRot = -x * 0.055;
      c.mesh.position.copy(c.base);
      c.mesh.rotation.y = -x * 0.055;
      this.root.add(c.mesh);
      return c;
    });

    // 执行环：一条闭合曲线穿过 6 张卡片前方
    const pts = SLOTS.map(([x, y]) => new THREE.Vector3(x, y, -3.5 - Math.abs(x) * 0.32 + 0.35));
    this.curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
    const geo = new THREE.BufferGeometry().setFromPoints(this.curve.getPoints(240));
    this.loop = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0x3a4a80, transparent: true, opacity: 0.55 }));
    this.root.add(this.loop);

    // 执行光点 + 拖尾
    const tex = makeSprite();
    this.trail = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x7df9ff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1 - i / 14 }));
      const k = (1 - i / 14) * 0.9 + 0.1;
      s.scale.set(0.9 * k, 0.9 * k, 1);
      this.root.add(s); this.trail.push(s);
    }
    this.u = 0;
    this.focusZ = 4;
    this.focusScale = 1.75;

    // HUD：当前步骤 + 训练日志
    this.hud = document.createElement("div");
    this.hud.className = "cv-hud";
    this.hud.innerHTML = `<div class="cv-now"></div><div class="cv-log"></div>`;
    ctx.body.appendChild(this.hud);
    this.nowEl = this.hud.querySelector(".cv-now");
    this.logEl = this.hud.querySelector(".cv-log");
    this.logN = -1;

    // 读取训练模块自己的源代码
    fetch(new URL("./train.js", import.meta.url)).then((r) => r.text()).then((txt) => {
      const lines = txt.split(/\r?\n/);
      this.cards.forEach((c) => { c.src = extract(lines, c.ph) || { from: 0, lines: ["// 未找到对应代码"] }; c.sig = ""; });
    }).catch(() => {});
  }

  resize(w, h) {
    super.resize(w, h);
    const tv = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), th = tv * (w / h);
    // 镜头距离：后方执行环（宽约 19、深约 -5.4）完整可见
    const D = Math.max(12, 9.6 / th - 5.4, 4.2 / tv - 5.4);
    this.camera.position.set(0, 0.8, D);
    this.controls.target.set(0, 0, 0);
    // 聚焦卡片：宽度占画面 86%，高度不超过 64%（下方留给训练日志）
    this.focusScale = 1.75;
    const cw = 5.6 * this.focusScale, ch = 3.36 * this.focusScale;
    const dist = Math.max(cw / 0.86 / 2 / th, ch / 0.64 / 2 / tv);
    this.focusZ = D - dist;
  }

  _cursor(card, tr) {
    const L = card.src?.lines;
    if (!L) return -1;
    const ph = tr.phase, n = L.length;
    if (card.ph.key === "forward" || card.ph.key === "backward") {
      const re = card.ph.key === "forward" ? /for \(let l = 0; l < L; l\+\+\) \{$/ : /for \(let l = L - 1/;
      const loop = L.findIndex((l) => re.test(l));
      const a = loop >= 0 ? loop : 0, span = n - a - 2;
      return Math.min(n - 1, a + Math.floor((ph.frac ?? 0) * Math.max(1, span)));
    }
    let k = ph.k;
    if (card.ph.key === "adam") k = Math.min(1, ph.k * 2);
    if (card.ph.key === "evaluate") k = Math.max(0, ph.k * 2 - 1);
    return Math.min(n - 1, Math.floor(k * n));
  }

  _info(key, tr) {
    const s = tr.sizes, ph = tr.phase, last = s.length - 2;
    const f = (v, d = 4) => (v == null ? "–" : v.toFixed(d));
    switch (key) {
      case "features": return `x ∈ ℝ^${s[0]} · 16 频带 + 12 色度 + 调性 + 振幅 + 质心`;
      case "forward": {
        const l = ph.name === "forward" ? ph.gap : 0;
        return `l = ${l} · ${s[l]} → ${s[l + 1]} · ${l === last ? (tr.mode === "distill" ? "sigmoid" : "linear") : "tanh"} · W[${l}] 有 ${s[l] * s[l + 1]} 个权重`;
      }
      case "loss": return `loss = ${f(tr.loss)} · ${tr.mode === "distill" ? "二元交叉熵 BCE" : "均方误差 MSE"}`;
      case "backward": {
        const l = ph.name === "backward" ? ph.gap : 0;
        return `l = ${l} · δ 从 ${s[l + 1]} 维传回 ${s[l]} 维 · ‖∇W‖ = ${tr.gnorm ? tr.gnorm.toExponential(2) : "–"}`;
      }
      case "adam": return `t = ${tr.t} · lr = ${tr.lr} · β1 = 0.9 · β2 = 0.999`;
      case "evaluate": return `val_loss = ${f(tr.valLoss)}` + (tr.acc != null ? ` · 与老师一致 ${(tr.acc * 100).toFixed(0)}%` : "") + " · 每 30 次迭代";
    }
    return "";
  }

  render(now) {
    const tr = this.store.train;
    const live = tr && performance.now() - (tr.at || 0) < 1000;
    const t = now / 1000;
    if (this.sway) this.root.rotation.y = 0.22 * Math.sin(t * 0.18);

    // ⑤ Adam 阶段的后半段，光点经过 ⑥ 验证卡片（验证每 30 次迭代运行一次）
    let activeKey = null;
    if (live && tr.active) activeKey = tr.phase.name === "adam" && tr.phase.k >= 0.5 ? "evaluate" : tr.phase.name;

    for (const c of this.cards) {
      const on = c.ph.key === activeKey;
      c.draw(on, on ? this._cursor(c, tr) : -1, live ? this._info(c.ph.key, tr) : "等待上方“神经网络 · 实时训练”运行…");
      // 正在执行的卡片飞到镜头前（放大可读），其余留在后方的执行环上
      c.f = (c.f || 0) + ((on ? 1 : 0) - (c.f || 0)) * 0.14;
      const e = c.f * c.f * (3 - 2 * c.f);
      c.mesh.position.set(c.base.x * (1 - e), c.base.y * (1 - e) + 0.45 * e, c.base.z + (this.focusZ - c.base.z) * e);
      c.mesh.rotation.y = c.baseRot * (1 - e) - this.root.rotation.y * e;
      c.mesh.scale.setScalar(1 + (this.focusScale - 1) * e);
      c.mesh.material.opacity = 0.5 + 0.5 * e;
      c.mesh.renderOrder = Math.round(e * 10);
    }

    // 光点在环上的位置
    if (live && tr.active) {
      const sp = SPAN[tr.phase.name];
      if (sp) this.u = (sp[0] + (sp[1] - sp[0]) * tr.phase.k) / 6;
    }
    const col = new THREE.Color(PHASES.find((p) => p.key === activeKey)?.color || "#7df9ff");
    this.trail.forEach((s, i) => {
      const u = (((this.u - i * 0.006) % 1) + 1) % 1;
      s.position.copy(this.curve.getPointAt(u));
      s.material.color.copy(col);
      s.visible = !!(live && tr.active);
    });
    this.loop.material.opacity = live && tr.active ? 0.6 : 0.25;

    // HUD
    if (live) {
      const ph = PHASES.find((p) => p.key === activeKey);
      this.nowEl.innerHTML = tr.active && ph
        ? `<b style="color:${ph.color}">${ph.no} ${ph.title}</b> <span>迭代 ${tr.steps.toLocaleString()}</span>`
        : `<span>训练${tr.steps ? "已暂停" : "等待样本"}</span>`;
      if (tr.log.length !== this.logN || tr.log.at(-1)?.at !== this.logLast) {
        this.logN = tr.log.length; this.logLast = tr.log.at(-1)?.at;
        this.logEl.innerHTML = tr.log.slice(-5).map((e) =>
          `<div class="cv-${e.kind}">${e.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("");
      }
    } else {
      this.nowEl.innerHTML = `<span>需要上方“神经网络 · 实时训练”模块在运行</span>`;
    }
    this.draw();
  }

  dispose() {
    this.hud.remove();
    for (const c of this.cards) { c.tex.dispose(); c.mesh.geometry.dispose(); c.mesh.material.dispose(); }
    super.dispose();
  }
}
