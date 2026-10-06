// 实时训练：在浏览器里训练一个小型神经网络（多层感知机），把训练的每一次迭代画出来。
//
// 两种模式：
//   蒸馏  —— “学生网络”只看 31 个声学特征（16 频带 + 12 色度 + 音调性 + 振幅 + 频谱质心），
//            学习预测 AST 大模型（“老师”）给出的 9 大类得分。标签来自识别引擎的 sound 消息。
//   自编码 —— 不需要识别模型：把 31 个特征压缩到 3 个神经元，再还原回来（学习声音的低维结构）。
//
// 画面：网络连线（暖色 = 正权重，冷色 = 负权重，亮度 = 权重大小，闪烁 = 本轮更新量），
//      青色脉冲 = 前向传播，品红脉冲 = 反向传播（梯度），下方为损失 / 准确率曲线。

import { GROUPS, GROUP_ORDER } from "../palette.js";

const N_IN = 31;
const IN_LABELS = [
  ...Array.from({ length: 16 }, (_, i) => (i === 0 ? "低频" : i === 15 ? "高频" : "")),
  ..."C C# D D# E F F# G G# A A# B".split(" "),
  "调性", "振幅", "质心",
];
const IN_GROUPS = [
  { name: "频带 ×16", from: 0, to: 15 },
  { name: "色度 ×12", from: 16, to: 27 },
  { name: "其它 ×3", from: 28, to: 30 },
];

const MODES = {
  distill: { name: "蒸馏 · 9 大类", sizes: [N_IN, 20, 14, GROUP_ORDER.length], out: "sigmoid" },
  auto:    { name: "自编码 · 3 维",     sizes: [N_IN, 12, 3, 12, N_IN],            out: "linear" },
};

/* ------------------------------ 特征 ------------------------------ */

function features(f) {
  const x = new Float32Array(N_IN);
  const b = f.bands || [];
  const step = b.length / 16 || 1;
  for (let i = 0; i < 16; i++) {
    let s = 0, n = 0;
    for (let k = Math.floor(i * step); k < Math.floor((i + 1) * step); k++) { s += b[k] || 0; n++; }
    x[i] = n ? s / n : 0;
  }
  const c = f.chroma || [];
  for (let i = 0; i < 12; i++) x[16 + i] = c[i] || 0;
  x[28] = f.tonality || 0;
  x[29] = Math.min(1, Math.sqrt(f.rms || 0) * 3);
  x[30] = f.centroid > 0 ? Math.min(1, Math.max(0, Math.log10(f.centroid / 80) / 2.3)) : 0;
  return x;
}

/* ------------------------------ 网络 ------------------------------ */

class MLP {
  constructor(sizes, out) {
    this.sizes = sizes; this.out = out; this.t = 0;
    this.W = []; this.b = []; this.mW = []; this.vW = []; this.mb = []; this.vb = [];
    this.gW = []; this.gb = []; this.flash = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const nin = sizes[l], nout = sizes[l + 1], n = nin * nout;
      const s = Math.sqrt(6 / (nin + nout));
      const W = new Float32Array(n);
      for (let k = 0; k < n; k++) W[k] = (Math.random() * 2 - 1) * s;
      this.W.push(W); this.b.push(new Float32Array(nout));
      this.mW.push(new Float32Array(n)); this.vW.push(new Float32Array(n));
      this.mb.push(new Float32Array(nout)); this.vb.push(new Float32Array(nout));
      this.gW.push(new Float32Array(n)); this.gb.push(new Float32Array(nout));
      this.flash.push(new Float32Array(n));
    }
  }

  forward(x) {
    const acts = [x];
    const L = this.W.length;
    for (let l = 0; l < L; l++) {
      const a = acts[l], nin = this.sizes[l], nout = this.sizes[l + 1], W = this.W[l], b = this.b[l];
      const z = new Float32Array(nout);
      for (let j = 0; j < nout; j++) {
        let s = b[j]; const o = j * nin;
        for (let i = 0; i < nin; i++) s += W[o + i] * a[i];
        z[j] = l < L - 1 ? Math.tanh(s) : this.out === "sigmoid" ? 1 / (1 + Math.exp(-s)) : s;
      }
      acts.push(z);
    }
    return acts;
  }

  loss(y, t) {
    let s = 0;
    if (this.out === "sigmoid") {
      for (let j = 0; j < y.length; j++) {
        const p = Math.min(1 - 1e-6, Math.max(1e-6, y[j]));
        s -= t[j] * Math.log(p) + (1 - t[j]) * Math.log(1 - p);
      }
    } else for (let j = 0; j < y.length; j++) s += (y[j] - t[j]) ** 2;
    return s / y.length;
  }

  /** 一个小批量的反向传播 + Adam 更新，返回平均损失 */
  step(batch, lr) {
    const L = this.W.length;
    for (let l = 0; l < L; l++) { this.gW[l].fill(0); this.gb[l].fill(0); }
    let total = 0;
    for (const [x, t] of batch) {
      const acts = this.forward(x);
      const y = acts[L];
      total += this.loss(y, t);
      let delta = new Float32Array(y.length);
      for (let j = 0; j < y.length; j++) delta[j] = (y[j] - t[j]) / y.length; // sigmoid+BCE 与 线性+MSE 形式相同
      for (let l = L - 1; l >= 0; l--) {
        const a = acts[l], nin = this.sizes[l], nout = this.sizes[l + 1], W = this.W[l];
        const gW = this.gW[l], gb = this.gb[l];
        const prev = l > 0 ? new Float32Array(nin) : null;
        for (let j = 0; j < nout; j++) {
          const d = delta[j], o = j * nin;
          gb[j] += d;
          for (let i = 0; i < nin; i++) {
            gW[o + i] += d * a[i];
            if (prev) prev[i] += d * W[o + i];
          }
        }
        if (prev) { for (let i = 0; i < nin; i++) prev[i] *= 1 - a[i] * a[i]; delta = prev; }
      }
    }
    let gsq = 0;
    for (let l = 0; l < L; l++) for (const g of this.gW[l]) gsq += (g / batch.length) ** 2;
    this.gnorm = Math.sqrt(gsq);
    // Adam
    this.t++;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8, n = batch.length;
    const c1 = 1 - b1 ** this.t, c2 = 1 - b2 ** this.t;
    for (let l = 0; l < L; l++) {
      const upd = (P, G, M, V, F) => {
        for (let k = 0; k < P.length; k++) {
          const g = G[k] / n + (F ? 1e-4 * P[k] : 0);
          M[k] = b1 * M[k] + (1 - b1) * g;
          V[k] = b2 * V[k] + (1 - b2) * g * g;
          const d = lr * (M[k] / c1) / (Math.sqrt(V[k] / c2) + eps);
          P[k] -= d;
          if (F) F[k] = Math.max(F[k] * 0.995, Math.min(1, Math.abs(d) / lr));
        }
      };
      upd(this.W[l], this.gW[l], this.mW[l], this.vW[l], this.flash[l]);
      upd(this.b[l], this.gb[l], this.mb[l], this.vb[l], null);
    }
    return total / n;
  }
}

/* ------------------------------ 模块 ------------------------------ */

export class TrainModule {
  static title = "神经网络 · 实时训练";

  constructor({ body, tools, store }) {
    this.store = store;
    this.body = body;
    body.classList.add("train-body");
    this.canvas = document.createElement("canvas");
    body.appendChild(this.canvas);
    this.g = this.canvas.getContext("2d");

    tools.innerHTML = `
      <select class="tr-mode" aria-label="训练模式" title="蒸馏：学习 AST 的 9 大类判断；自编码：不需要识别模型">
        ${Object.entries(MODES).map(([k, m]) => `<option value="${k}">${m.name}</option>`).join("")}
      </select>
      <select class="tr-lr" aria-label="学习率" title="学习率（每一步权重更新的幅度）">
        <option value="0.01">lr 0.01</option><option value="0.003" selected>lr 0.003</option>
        <option value="0.001">lr 0.001</option><option value="0.0003">lr 0.0003</option>
      </select>
      <button class="btn ghost tr-run on" title="暂停 / 继续训练">⏸</button>
      <button class="btn ghost tr-reset" title="重置：重新随机初始化权重">↺</button>`;
    this.modeSel = tools.querySelector(".tr-mode");
    this.lrSel = tools.querySelector(".tr-lr");
    this.runBtn = tools.querySelector(".tr-run");
    this.modeSel.onchange = () => this.reset(true);
    tools.querySelector(".tr-reset").onclick = () => this.reset(false);
    this.runBtn.onclick = () => {
      this.running = !this.running;
      this.runBtn.textContent = this.running ? "⏸" : "▶";
      this.runBtn.classList.toggle("on", this.running);
    };

    this.running = true;
    this.w = 300; this.h = 200;
    this.seen = new Set();
    this.reset(true);
  }

  reset(clearData) {
    this.mode = this.modeSel.value;
    const m = MODES[this.mode];
    this.net = new MLP(m.sizes, m.out);
    this.steps = 0; this.seenSamples = 0;
    this.hist = []; this.histEvery = 10; this.lastLoss = null; this.valLoss = null; this.acc = null;
    this.lossEma = null;
    if (clearData) { this.train = []; this.val = []; this.seen = new Set(); this.frameN = 0; }
    this.live = null;
    this.pulse = 0;
    if (!this.log || clearData) this.log = [];
    const nParams = this.net.W.reduce((a, w) => a + w.length, 0) + this.net.b.reduce((a, b) => a + b.length, 0);
    this._log("init", `[初始化] Xavier 随机权重 · MLP ${m.sizes.join("→")} · ${nParams.toLocaleString()} 个参数 · ${m.name}`);
  }

  _log(kind, text) {
    this.log.push({ kind, text, at: performance.now() });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
  }

  /** 可视化周期：特征 → 前向（逐层）→ 损失 → 反向（逐层）→ Adam 更新。下方“代码 3D”模块按同一时间轴高亮代码 */
  _phase() {
    const G = this.net.sizes.length - 1, S = 0.7;
    let p = this.pulse % (S + G + S + G + S);
    if (p < S) return { name: "features", k: p / S };
    p -= S;
    if (p < G) return { name: "forward", gap: Math.floor(p), frac: p % 1, k: p / G };
    p -= G;
    if (p < S) return { name: "loss", k: p / S };
    p -= S;
    if (p < G) return { name: "backward", gap: G - 1 - Math.floor(p), frac: 1 - (p % 1), k: p / G };
    p -= G;
    return { name: "adam", k: p / S };
  }

  onClear() { this.reset(true); }

  onFrame(f) {
    this.liveX = features(f);
    if (this.mode === "auto" && (this.frameN++ % 3 === 0) && (f.rms || 0) > 1e-4) {
      this._add(this.liveX, this.liveX);
      if (this.seenSamples % 200 === 0) this._log("data", `[数据] 自编码样本累计 ${this.seenSamples} 个（目标 = 输入本身）`);
    }
  }

  _add(x, t) {
    const n = this.seenSamples++;
    if (n % 10 === 9) { this.val.push([x, t]); if (this.val.length > 400) this.val.shift(); }
    else { this.train.push([x, t]); if (this.train.length > 4000) this.train.shift(); }
  }

  /** 把识别引擎新给出的 sound 标签变成训练样本 */
  _harvest() {
    for (const s of this.store.sounds) {
      if (!s.groups) continue;
      const key = s.t.toFixed(2);
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const t = Float32Array.from(GROUP_ORDER, (g) => Math.min(1, s.groups[g] || 0));
      const frames = this.store.window(s.t, s.t_end ?? s.t + 4);
      let n = 0;
      for (let i = 0; i < frames.length; i += 3) { this._add(features(frames[i]), t); n++; }
      let top = 0;
      for (let j = 1; j < t.length; j++) if (t[j] > t[top]) top = j;
      const g = GROUP_ORDER[top];
      this._log("data", `[数据] +${n} 样本 ← AST 标签 @ ${s.t.toFixed(1)}–${(s.t_end ?? s.t + 4).toFixed(1)} s · 主类 ${GROUPS[g]?.name || g} ${t[top].toFixed(2)}`);
    }
  }

  _evaluate() {
    if (!this.val.length) return;
    let loss = 0, hit = 0, cnt = 0;
    for (const [x, t] of this.val) {
      const y = this.net.forward(x).at(-1);
      loss += this.net.loss(y, t);
      if (this.mode === "distill") {
        let ay = 0, at = 0;
        for (let j = 1; j < t.length; j++) { if (y[j] > y[ay]) ay = j; if (t[j] > t[at]) at = j; }
        if (t[at] > 0.1) { cnt++; if (ay === at) hit++; }
      }
    }
    this.valLoss = loss / this.val.length;
    this.acc = cnt ? hit / cnt : null;
    this.evalAt = performance.now();
    if (this.steps % 1500 === 0)
      this._log("eval", `[验证] ${this.val.length} 个样本 · val_loss=${this.valLoss.toFixed(4)}` +
        (this.acc != null ? ` · 与老师一致 ${(this.acc * 100).toFixed(0)}%` : ""));
  }

  _train() {
    if (!this.running || this.train.length < 24) return;
    const lr = parseFloat(this.lrSel.value);
    for (let s = 0; s < 6; s++) {
      const batch = [];
      for (let k = 0; k < 24; k++) batch.push(this.train[(Math.random() * this.train.length) | 0]);
      const l = this.net.step(batch, lr);
      this.lossEma = this.lossEma == null ? l : this.lossEma * 0.97 + l * 0.03;
      this.steps++;
      if (this.steps % 480 === 0)
        this._log("step", `[迭代 ${this.steps}] batch=24 · loss=${l.toFixed(4)} · ‖∇W‖=${this.net.gnorm.toExponential(2)} · lr=${lr}`);
      if (this.steps % 30 === 0) this._evaluate();
      if (this.steps % this.histEvery === 0) {
        this.hist.push([this.lossEma, this.valLoss, this.acc]);
        if (this.hist.length > 400) {           // 满了就隔点抽稀，整条历史始终可见
          this.hist = this.hist.filter((_, i) => i % 2 === 0);
          this.histEvery *= 2;
        }
      }
    }
  }

  resize(w, h) {
    this.w = w; this.h = h;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + "px"; this.canvas.style.height = h + "px";
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render() {
    if (this.mode === "distill") this._harvest();
    this._train();
    if (this.running && this.train.length >= 24) this.pulse += 0.016;
    this.phase = this._phase();
    this.store.train = {
      mode: this.mode, sizes: this.net.sizes, phase: this.phase, active: this.running && this.train.length >= 24,
      steps: this.steps, loss: this.lossEma, valLoss: this.valLoss, acc: this.acc, gnorm: this.net.gnorm,
      lr: parseFloat(this.lrSel.value), nTrain: this.train.length, nVal: this.val.length,
      evalAt: this.evalAt || 0, log: this.log, t: this.net.t,
      at: performance.now(),
    };
    this._draw();
  }

  /* ------------------------------ 绘制 ------------------------------ */

  _draw() {
    const g = this.g, W = this.w, H = this.h, net = this.net, sizes = net.sizes, L = sizes.length;
    g.clearRect(0, 0, W, H);
    g.font = "11px ui-sans-serif, system-ui, sans-serif";
    g.textBaseline = "middle";

    // ---- 标题与数据 ----
    const m = MODES[this.mode];
    g.fillStyle = "#e6ebff"; g.textAlign = "left";
    g.fillText(`MLP ${sizes.join(" → ")}`, 12, 14);
    g.fillStyle = "#8a96c0";
    const info = this.mode === "distill"
      ? "学生网络只看 31 个声学特征，学习模仿 AST 大模型的 9 大类判断"
      : "把 31 个特征压缩到中间 3 个神经元，再还原（学习声音的低维结构）";
    g.fillText(info, 12, 48);

    const epoch = this.train.length ? (this.steps * 24) / this.train.length : 0;
    const stats = [
      ["迭代", this.steps.toLocaleString()],
      ["轮次", epoch.toFixed(1)],
      ["样本", `${this.train.length}+${this.val.length}`],
      ["训练损失", this.lossEma != null ? this.lossEma.toFixed(4) : "–"],
      ["验证损失", this.valLoss != null ? this.valLoss.toFixed(4) : "–"],
    ];
    if (this.mode === "distill") stats.push(["与老师一致", this.acc != null ? (this.acc * 100).toFixed(0) + "%" : "–"]);
    g.textAlign = "right";
    let sx = W - 12;
    for (let i = stats.length - 1; i >= 0; i--) {
      const [k, v] = stats[i];
      g.fillStyle = "#e6ebff"; g.font = "600 12px ui-monospace, Consolas, monospace";
      g.fillText(v, sx, 14);
      const vw = g.measureText(v).width;
      g.fillStyle = "#6f7ba6"; g.font = "10px ui-sans-serif, system-ui, sans-serif";
      g.fillText(k, sx, 30);
      sx -= Math.max(vw, g.measureText(k).width) + 18;
    }
    g.font = "11px ui-sans-serif, system-ui, sans-serif";

    // ---- 区域划分 ----
    const top = 78, chartH = Math.max(70, Math.min(140, H * 0.27));
    const netBottom = H - chartH - 14;
    const left = 92, right = this.mode === "distill" ? 168 : 70;
    const x0 = left, x1 = W - right;
    const colX = (l) => x0 + ((x1 - x0) * l) / (L - 1);
    const nodeY = (l, i) => {
      const n = sizes[l], span = Math.min(netBottom - top - 22, n * 22);
      const c = (top + netBottom - 12) / 2;
      return n === 1 ? c : c - span / 2 + (span * i) / (n - 1);
    };

    // 等待数据
    if (this.train.length < 24) {
      g.fillStyle = "#8a96c0"; g.textAlign = "center";
      const msg = this.mode === "distill"
        ? (this.store.ai && !String(this.store.ai.sound || "").startsWith("就绪")
            ? "声音识别模型未就绪 —— 可切换到“自编码”模式（不需要识别模型）"
            : "播放音频后，等待 AST 给出第一批标签（约 4 秒）…")
        : "播放音频后开始收集样本…";
      g.fillText(msg, W / 2, netBottom + 2);
    }

    // 当前帧前向传播（实时激活）
    const acts = this.liveX ? net.forward(this.liveX) : null;

    // 脉冲：特征 → 前向（青）→ 损失 → 反向（品红）→ Adam 更新（所有连线闪一下）
    const ph = this.phase || this._phase();
    const fwd = ph.name === "forward";
    const gap = ph.name === "forward" || ph.name === "backward" ? ph.gap : -1;
    const frac = ph.frac ?? 0;
    const active = this.running && this.train.length >= 24;
    const adamBoost = active && ph.name === "adam" ? 0.35 * Math.sin(Math.PI * ph.k) : 0;

    // ---- 连线 ----
    g.lineWidth = 1;
    for (let l = 0; l < L - 1; l++) {
      const Wl = net.W[l], F = net.flash[l], nin = sizes[l], nout = sizes[l + 1];
      let wmax = 1e-6;
      for (let k = 0; k < Wl.length; k++) wmax = Math.max(wmax, Math.abs(Wl[k]));
      const xa = colX(l), xb = colX(l + 1);
      const hot = active && l === gap;
      for (let j = 0; j < nout; j++) {
        const yb = nodeY(l + 1, j);
        for (let i = 0; i < nin; i++) {
          const k = j * nin + i, w = Wl[k], s = Math.abs(w) / wmax;
          const a = Math.min(1, 0.04 + 0.42 * s * s + (0.35 + adamBoost * 2) * F[k]);
          g.strokeStyle = w >= 0 ? `rgba(255,170,90,${a.toFixed(3)})` : `rgba(80,190,255,${a.toFixed(3)})`;
          g.beginPath(); g.moveTo(xa, nodeY(l, i)); g.lineTo(xb, yb); g.stroke();
        }
      }
      // 脉冲：沿最强的连线移动的亮点
      if (hot) {
        const col = fwd ? "125,249,255" : "255,92,214";
        for (let j = 0; j < nout; j++) {
          const yb = nodeY(l + 1, j);
          for (let i = 0; i < nin; i++) {
            const k = j * nin + i, s = Math.abs(Wl[k]) / wmax;
            if (s < 0.45) continue;
            const ya = nodeY(l, i);
            const px = xa + (xb - xa) * frac, py = ya + (yb - ya) * frac;
            g.fillStyle = `rgba(${col},${(0.25 + 0.75 * s).toFixed(2)})`;
            g.beginPath(); g.arc(px, py, 1.2 + 1.6 * s, 0, Math.PI * 2); g.fill();
          }
        }
      }
    }

    // ---- 神经元 ----
    for (let l = 0; l < L; l++) {
      for (let i = 0; i < sizes[l]; i++) {
        const x = colX(l), y = nodeY(l, i);
        let v = acts ? acts[l][i] : 0;
        if (l > 0 && l < L - 1) v = (v + 1) / 2;           // tanh → 0..1
        v = Math.max(0, Math.min(1, v));
        const r = l === 0 || l === L - 1 ? 3.2 : 4.4;
        g.fillStyle = `rgba(${Math.round(40 + 85 * v)},${Math.round(60 + 189 * v)},${Math.round(110 + 145 * v)},1)`;
        g.strokeStyle = "rgba(200,215,255,.35)";
        g.beginPath(); g.arc(x, y, r + v * 2.2, 0, Math.PI * 2); g.fill(); g.stroke();
        const ring = active && ((ph.name === "features" && l === 0) || (ph.name === "loss" && l === L - 1));
        if (ring) {
          g.strokeStyle = ph.name === "loss" ? "rgba(255,209,102,.9)" : "rgba(125,249,255,.9)";
          g.beginPath(); g.arc(x, y, r + 4 + 3 * Math.sin(Math.PI * ph.k), 0, Math.PI * 2); g.stroke();
        }
      }
    }

    // ---- 输入层说明 ----
    g.textAlign = "right";
    for (const grp of IN_GROUPS) {
      const ya = nodeY(0, grp.from), yb = nodeY(0, grp.to);
      g.strokeStyle = "rgba(138,150,192,.5)";
      g.beginPath(); g.moveTo(x0 - 12, ya); g.lineTo(x0 - 16, ya); g.lineTo(x0 - 16, yb); g.lineTo(x0 - 12, yb); g.stroke();
      g.fillStyle = "#8a96c0"; g.fillText(grp.name, x0 - 20, (ya + yb) / 2);
    }
    g.fillStyle = "#6f7ba6"; g.textAlign = "center";
    g.fillText("输入层", colX(0), netBottom + 2);
    for (let l = 1; l < L - 1; l++) g.fillText(this.mode === "auto" && sizes[l] === 3 ? "瓶颈 3 维" : `隐藏层 ${l}`, colX(l), netBottom + 2);
    g.fillText("输出层", colX(L - 1), netBottom + 2);

    // ---- 输出层：学生预测 vs 老师标签 ----
    if (this.mode === "distill") {
      const snd = this.store.activeAt("sounds", this.store.time, 3.5);
      g.textAlign = "left";
      for (let j = 0; j < sizes[L - 1]; j++) {
        const grp = GROUP_ORDER[j], y = nodeY(L - 1, j), x = x1 + 12;
        const yv = acts ? acts[L - 1][j] : 0;
        const tv = snd?.groups?.[grp] ?? null;
        g.fillStyle = GROUPS[grp]?.color || "#aaa";
        g.fillText(GROUPS[grp]?.name || grp, x, y);
        const bx = x + 60, bw = right - 78;
        g.fillStyle = "rgba(255,255,255,.07)"; g.fillRect(bx, y - 4, bw, 8);
        g.fillStyle = GROUPS[grp]?.color || "#aaa"; g.globalAlpha = 0.85;
        g.fillRect(bx, y - 4, bw * yv, 8); g.globalAlpha = 1;
        if (tv != null) {                    // 老师（AST）的答案：白色竖线
          g.fillStyle = "#fff"; g.fillRect(bx + bw * Math.min(1, tv) - 1, y - 7, 2, 14);
        }
      }
      g.fillStyle = "#6f7ba6"; g.font = "10px ui-sans-serif, system-ui, sans-serif";
      g.fillText("色条 学生预测 · 白线 AST 老师", x1 + 12, top - 12);
      g.font = "11px ui-sans-serif, system-ui, sans-serif";
    }

    // ---- 图例 ----
    g.textAlign = "left"; g.fillStyle = "#6f7ba6"; g.font = "10px ui-sans-serif, system-ui, sans-serif";
    const ly = 64;
    const legend = [["rgba(255,170,90,.9)", "正权重"], ["rgba(80,190,255,.9)", "负权重"],
                    ["rgb(125,249,255)", "前向传播"], ["rgb(255,92,214)", "反向传播"]];
    let lx = 10;
    for (const [c, t] of legend) {
      g.fillStyle = c; g.fillRect(lx, ly - 1, 10, 2); lx += 14;
      g.fillStyle = "#6f7ba6"; g.fillText(t, lx, ly); lx += g.measureText(t).width + 10;
    }

    // ---- 损失曲线 ----
    this._drawChart(10, H - chartH - 4, W - 20, chartH);
  }

  _drawChart(x, y, w, h) {
    const g = this.g, H = this.hist;
    g.strokeStyle = "rgba(138,150,192,.25)"; g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.fillStyle = "#6f7ba6"; g.textAlign = "left"; g.font = "10px ui-sans-serif, system-ui, sans-serif";
    g.fillText("损失（对数刻度）", x + 6, y + 9);
    if (H.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const [a, b] of H) for (const v of [a, b]) if (v != null && v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!isFinite(lo)) return;
    const llo = Math.log10(lo) - 0.05, lhi = Math.log10(hi) + 0.05;
    const px = (i) => x + 4 + ((w - 8) * i) / (H.length - 1);
    const py = (v) => y + h - 4 - ((h - 18) * (Math.log10(v) - llo)) / (lhi - llo || 1);
    const line = (idx, color, width) => {
      g.strokeStyle = color; g.lineWidth = width; g.beginPath();
      let started = false;
      H.forEach((r, i) => {
        const v = r[idx]; if (v == null || v <= 0) return;
        if (!started) { g.moveTo(px(i), py(v)); started = true; } else g.lineTo(px(i), py(v));
      });
      g.stroke();
    };
    line(0, "rgba(125,249,255,.95)", 1.6);
    line(1, "rgba(255,184,107,.9)", 1.2);
    if (this.mode === "distill") {      // 准确率（右轴 0–100%）
      g.strokeStyle = "rgba(155,225,93,.85)"; g.lineWidth = 1.2; g.setLineDash([3, 3]); g.beginPath();
      let started = false;
      H.forEach((r, i) => {
        if (r[2] == null) return;
        const yy = y + h - 4 - (h - 18) * r[2];
        if (!started) { g.moveTo(px(i), yy); started = true; } else g.lineTo(px(i), yy);
      });
      g.stroke(); g.setLineDash([]);
    }
    // 刻度与图例
    g.textAlign = "right"; g.fillStyle = "#6f7ba6";
    g.fillText(hi.toPrecision(2), x + w - 6, y + 9);
    g.fillText(lo.toPrecision(2), x + w - 6, y + h - 8);
    g.textAlign = "left";
    let lx = x + 110;
    for (const [c, t] of [["rgba(125,249,255,.95)", "训练损失"], ["rgba(255,184,107,.9)", "验证损失"],
                          ...(this.mode === "distill" ? [["rgba(155,225,93,.85)", "与老师一致率"]] : [])]) {
      g.fillStyle = c; g.fillRect(lx, y + 8, 12, 2); lx += 16;
      g.fillStyle = "#6f7ba6"; g.fillText(t, lx, y + 9); lx += g.measureText(t).width + 14;
    }
  }

  dispose() { this.canvas.remove(); this.body.classList.remove("train-body"); }
}
