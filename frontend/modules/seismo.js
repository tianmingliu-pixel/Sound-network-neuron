// 模块：声学轨迹 3D（ACOUSTIC TRAJECTORY）—— 地震仪式的 3D 游走线
//
//   空间：无边框的透明长方体 —— 只有半透明的地面和中间竖立的透明板，没有任何框线；
//         三根坐标轴带刻度（参照 Lucio Arese 的 MULTI-SCALE ANALYSIS）。
//   轨迹：每一帧是空间中的一个点，三个坐标全部来自声音，相邻帧连成一条在 3D 空间里游走的线：
//         X（横）   频谱质心：音色的亮暗（对数 Hz，随工具栏音高范围）
//         Y（纵深） 时间：整段模式铺满整个文件（边播边写），滚动模式为最近 N 秒
//         Z（高度） 音高（默认，YIN 基频；无音高时沿用上一个音高并变暗）或 音调性（参考作品的用法）
//         颜色      振幅（plasma 色带，深紫 → 洋红 → 橙 → 黄）
//   辅助：线上的亮点、落到地面的淡竖线和地面投影（帮助判断空间位置），可关闭。
//   整体绕竖轴慢慢旋转，从不同角度观察声音在空间里的轨迹。
//
//   特效「闪电」（默认，夜空背景）：
//     线芯为电光色（深靛 → 电蓝 → 青 → 白热，按振幅），外层紫蓝光晕随机闪烁；
//     笔尖后约半秒的线像电弧一样抖动；
//     强烈的声音起点（后端事件，振幅 ≥ 0.45）从轨迹劈下一道带分叉的闪电落到地面，
//     同时空间闪光、轻微震动（“雷鸣”）。
//   特效「平滑」：科研灰或深色背景，振幅用 plasma 色带。

import * as THREE from "three";
import { ThreeModule } from "../core/three-base.js";
import { centroidNorm, pitch, pitchTicks, fmtHz, plasmaRgb, plasmaGradient, makePointMaterial, textSprite, noteName } from "../palette.js";

const W = 8, DP = 12, H = 5, MAX = 6000;
const SPEEDS = { slow: 120, mid: 60, fast: 30 };
// 视角预设（相机位置；目标始终是模型中心）
const VIEWS = {
  side: [14, 5.2, 11],      // 3D 侧视：接近水平，立体感最强（默认）
  high: [11, 9.5, 12],      // 斜俯视
  flat: [17, 2.6, 0.01],    // 正侧面
  top: [0.01, 19, 0.01],    // 俯视
};
// 闪电色带：深靛 → 电蓝 → 青 → 白热
const LIGHTNING = [[0.10, 0.12, 0.42], [0.23, 0.36, 1.0], [0.49, 0.98, 1.0], [0.92, 0.99, 1.0]];
const lightningRgb = (v) => {
  const t = Math.min(1, Math.max(0, v)) * (LIGHTNING.length - 1), i = Math.min(LIGHTNING.length - 2, Math.floor(t)), f = t - i;
  const a = LIGHTNING[i], b = LIGHTNING[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
};
const MAX_BOLT = 3000;

const THEMES = {
  night: { bg: 0x04050c, bgRgb: [0.016, 0.02, 0.047], ink: 0x8fa8ff, sub: "#8f9cc4", head: "#dfe6ff", blend: THREE.AdditiveBlending },
  gray: { bg: 0x4a4c52, bgRgb: [0.29, 0.298, 0.322], ink: 0xffffff, sub: "#d5d9e6", head: "#ffffff", blend: THREE.NormalBlending },
  dark: { bg: 0x0a0d16, bgRgb: [0.04, 0.05, 0.09], ink: 0xbfd0ff, sub: "#9aa6cc", head: "#e6ebf7", blend: THREE.AdditiveBlending },
};
const niceStep = (span, target = 6) => {
  const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) || raw;
};
const fmtT = (t) => (t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}` : `${+t.toFixed(1)}s`);

export class SeismoModule extends ThreeModule {
  static title = "声学轨迹 3D";

  constructor(ctx) {
    super({ body: ctx.body, pos: VIEWS.side, target: [0, H / 2 - 0.6, 0], background: 0x04050c });
    this.store = ctx.store;
    this.theme = "night";
    this.fx = "lightning";
    this.mode = "auto";
    this.bolts = [];          // 正在显示的闪电 {segs, born}
    this.flash = 0;           // 闪光强度（雷鸣）
    this.seenNodes = ctx.store.nodes.length;
    this.lastBolt = 0;
    this.zMode = "pitch";
    this.drops = true;
    this.rotating = true;
    this.period = SPEEDS.mid;
    this.angle = 0.6;
    this.lastNow = null;

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.frame = new THREE.Group();   // 透明面 + 坐标轴（主题切换时重建）
    this.ticks = new THREE.Group();   // 刻度（随模式 / 时长 / 范围重建）
    this.root.add(this.frame, this.ticks);

    const seg = (n, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      g.setDrawRange(0, 0);
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false }));
      l.frustumCulled = false;
      this.root.add(l);
      return l;
    };
    this.path = seg(MAX, 1.0);       // 游走线
    this.glow = seg(MAX, 0.28);      // 微偏移的第二条线，形成柔和光晕
    this.glow2 = seg(MAX, 0.2);      // 闪电模式：外层紫色光晕
    this.boltL = seg(MAX_BOLT, 1.0); // 闪电分叉
    this.boltL.material.blending = THREE.AdditiveBlending;
    this.shadow = seg(MAX, 0.3);     // 地面投影
    this.dropL = seg(MAX, 0.22);     // 落地竖线
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    pg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    pg.setAttribute("size", new THREE.BufferAttribute(new Float32Array(MAX), 1));
    pg.setDrawRange(0, 0);
    this.dots = new THREE.Points(pg, makePointMaterial());
    this.dots.frustumCulled = false;
    this.root.add(this.dots);
    this.pen = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }));
    this.root.add(this.pen);

    this.hud = document.createElement("div");
    this.hud.className = "seismo-hud";
    this.hud.innerHTML = `
      <div class="sh-title"><b>ACOUSTIC TRAJECTORY</b><span class="sh-name"></span><span class="sh-sp"></span></div>
      <div class="sh-bar"><span>AMPLITUDE · 振幅</span><i style="background:${plasmaGradient("to right")}"></i><span class="lr"><em>弱</em><em>强</em></span></div>
      <div class="sh-read"></div>`;
    ctx.body.appendChild(this.hud);
    this.q = (s) => this.hud.querySelector(s);

    ctx.tools.innerHTML = `
      <label class="field mini">高度
        <select data-k="z"><option value="pitch">音高</option><option value="tonality">音调性</option></select></label>
      <label class="field mini">模式
        <select data-k="mode"><option value="auto">自动</option><option value="whole">整段</option><option value="scroll">滚动</option></select></label>
      <label class="field mini">旋转
        <select data-k="speed"><option value="slow">慢</option><option value="mid" selected>中</option><option value="fast">快</option><option value="stop">停</option></select></label>
      <label class="field mini">视角
        <select data-k="view"><option value="side">3D 侧视</option><option value="high">斜俯视</option><option value="flat">正侧面</option><option value="top">俯视</option></select></label>
      <button class="btn mini on" data-k="drops" title="落地竖线与地面投影">竖线</button>
      <label class="field mini">特效
        <select data-k="fx"><option value="lightning">闪电 · 夜空</option><option value="gray">平滑 · 科研灰</option><option value="dark">平滑 · 深色</option></select></label>`;
    const T = ctx.tools;
    T.querySelector("[data-k=z]").onchange = (e) => { this.zMode = e.target.value; this.tickSig = ""; };
    T.querySelector("[data-k=view]").onchange = (e) => {
      this.camera.position.set(...VIEWS[e.target.value]);
      this.controls.target.set(0, H / 2 - 0.6, 0);
      this.controls.update();
    };
    T.querySelector("[data-k=mode]").onchange = (e) => { this.mode = e.target.value; this.tickSig = ""; };
    T.querySelector("[data-k=speed]").onchange = (e) => {
      this.rotating = e.target.value !== "stop";
      if (this.rotating) this.period = SPEEDS[e.target.value];
    };
    T.querySelector("[data-k=drops]").onclick = (e) => { this.drops = !this.drops; e.target.classList.toggle("on", this.drops); };
    T.querySelector("[data-k=fx]").onchange = (e) => {
      const v = e.target.value;
      this.fx = v === "lightning" ? "lightning" : "smooth";
      this.theme = v === "lightning" ? "night" : v;
      this.bolts = []; this.flash = 0;
      this._applyTheme();
    };
    this._applyTheme();
  }

  // ------------------------------------------------------------------ 空间
  _applyTheme() {
    const T = THEMES[this.theme];
    this.renderer.setClearColor(T.bg, 1);
    this.hud.dataset.theme = this.theme;
    for (const l of [this.path, this.glow, this.glow2, this.shadow, this.dropL]) { l.material.blending = T.blend; l.material.needsUpdate = true; }
    const lg = this.q(".sh-bar i"), lt = this.q(".sh-bar span");
    if (this.fx === "lightning") {
      lg.style.background = "linear-gradient(to right, #1a1f6b, #3a5bff, #7df9ff, #ebfcff)";
      lt.textContent = "AMPLITUDE · 振幅（电光）";
    } else {
      lg.style.background = plasmaGradient("to right");
      lt.textContent = "AMPLITUDE · 振幅";
    }
    const g = this.frame;
    g.clear();
    // 无边框的透明面：地面 + 中间竖立的透明板（沿时间方向）
    const pane = (w, h, opacity, pos, rot) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
        color: T.ink, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
      m.position.set(...pos); m.rotation.set(...rot); m.renderOrder = -1;
      g.add(m);
    };
    pane(W, DP, 0.06, [0, 0, 0], [-Math.PI / 2, 0, 0]);
    pane(DP, H, 0.06, [0, H / 2, 0], [0, Math.PI / 2, 0]);
    // 三根坐标轴（只有轴线，没有长方体边框）
    const axes = new THREE.BufferGeometry();
    axes.setAttribute("position", new THREE.Float32BufferAttribute([
      -W / 2, 0, DP / 2, W / 2, 0, DP / 2,     // X：频谱质心（前沿）
      W / 2, 0, -DP / 2, W / 2, 0, DP / 2,     // Y：时间（右沿）
      0, 0, -DP / 2, 0, H, -DP / 2,            // Z：高度（中间透明板的后端竖边）
    ], 3));
    g.add(new THREE.LineSegments(axes, new THREE.LineBasicMaterial({ color: T.ink, transparent: true, opacity: 0.8 })));
    this.tickSig = "";
  }

  _label(text, x, y, z, px = 22, color, spacing = 0) {
    const s = textSprite(text, color ?? THEMES[this.theme].sub, px, spacing);
    s.position.set(x, y, z);
    this.ticks.add(s);
  }

  _ticks(whole, span) {
    const sig = `${this.theme}|${whole}|${Math.round(span * 10)}|${pitch.version}|${this.zMode}`;
    if (sig === this.tickSig) return;
    this.tickSig = sig;
    const T = THEMES[this.theme];
    this.ticks.clear();
    const seg = [];
    // X 刻度：频谱质心
    for (const f of pitchTicks(5)) {
      const x = (centroidNorm(f) * 2 - 1) * (W / 2);
      seg.push(x, 0, DP / 2, x, 0, DP / 2 + 0.15);
      this._label(fmtHz(f), x, -0.35, DP / 2 + 0.5);
    }
    this._label("SPECTRAL CENTROID · 音色", 0, -0.95, DP / 2 + 1.1, 24, T.head, 2);
    // Y 刻度：时间
    if (whole) {
      const step = niceStep(span);
      for (let t = 0; t <= span + 1e-6; t += step) {
        const z = -DP / 2 + (t / span) * DP;
        seg.push(W / 2, 0, z, W / 2 + 0.15, 0, z);
        this._label(fmtT(t), W / 2 + 0.6, -0.3, z);
      }
    } else {
      const step = span <= 10 ? 2 : span <= 20 ? 5 : 10;
      for (let r = -span; r <= 0; r += step) {
        const z = -DP / 2 + ((r + span) / span) * DP;
        seg.push(W / 2, 0, z, W / 2 + 0.15, 0, z);
        this._label(r === 0 ? "现在" : `${r}s`, W / 2 + 0.6, -0.3, z);
      }
    }
    this._label(whole ? "TIME · 时间（整段）" : "TIME · 时间（滚动）", W / 2 + 1.4, -0.9, 0, 24, T.head, 2);
    // Z 刻度：音高（每个八度的 C）或音调性（0–1）
    if (this.zMode === "pitch") {
      const lo = Math.ceil(69 + 12 * Math.log2(pitch.min / 440)), hi = Math.floor(69 + 12 * Math.log2(pitch.max / 440));
      for (let m = lo; m <= hi; m++) {
        if (m % 12 !== 0) continue;
        const y = centroidNorm(440 * Math.pow(2, (m - 69) / 12)) * H;
        seg.push(0, y, -DP / 2, 0.15, y, -DP / 2);
        this._label(`C${m / 12 - 1}`, 0.55, y, -DP / 2);
      }
      this._label("PITCH · 音高", 0, H + 0.45, -DP / 2, 24, T.head, 2);
    } else {
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        const y = v * H;
        seg.push(0, y, -DP / 2, 0.15, y, -DP / 2);
        this._label(v.toFixed(2), 0.6, y, -DP / 2);
      }
      this._label("TONALITY · 音调性", 0, H + 0.45, -DP / 2, 24, T.head, 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
    this.ticks.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: T.ink, transparent: true, opacity: 0.8 })));
  }

  // ------------------------------------------------------------------ 渲染
  render(now) {
    const t = (now ?? performance.now()) / 1000;
    if (this.lastNow !== null && this.rotating) this.angle += (Math.min(0.1, t - this.lastNow) / this.period) * Math.PI * 2;
    this.lastNow = t;
    this.root.rotation.y = this.angle;
    this.root.rotation.x = THREE.MathUtils.degToRad(4) * Math.sin(this.angle * 2);

    // 雷鸣：闪光衰减 + 轻微震动
    const TH0 = THEMES[this.theme];
    this.flash *= 0.88;
    if (this.fx === "lightning") {
      const f = Math.min(1, this.flash);
      const [br, bgc, bb] = TH0.bgRgb;
      this.renderer.setClearColor(new THREE.Color(br + (0.16 - br) * f * 0.35, bgc + (0.2 - bgc) * f * 0.35, bb + (0.42 - bb) * f * 0.35), 1);
      this.root.position.set((Math.random() - 0.5) * 0.12 * f, (Math.random() - 0.5) * 0.08 * f, 0);
    } else {
      this.root.position.set(0, 0, 0);
    }

    const s = this.store, last = s.latest();
    const whole = this.mode === "whole" || (this.mode === "auto" && s.duration > 0);
    const span = whole ? Math.max(1, s.duration || (last ? last.t : 1)) : s.settings.windowSec;
    const t1 = last ? last.t : 0;
    this._ticks(whole, span);
    this._hud(whole, span, last);

    // 取帧
    let pts;
    if (whole) {
      const n = Math.ceil(span * 60) + 1, step = Math.max(1, Math.ceil(n / MAX));
      pts = [];
      for (let i = 0; i < n; i += step) {
        let best = null;   // 步长内取最响的一帧，长文件也不漏峰值
        for (let j = i; j < Math.min(n, i + step); j++) { const f = s.trace[j]; if (f && (!best || f.rms > best.rms)) best = f; }
        pts.push(best);
      }
    } else {
      pts = s.window(t1 - span, t1);
      const stride = Math.max(1, Math.ceil(pts.length / MAX));
      if (stride > 1) pts = pts.filter((_, i) => i % stride === 0);
    }

    const TH = THEMES[this.theme], bg = TH.bgRgb;
    const A = this.path.geometry.attributes, G = this.glow.geometry.attributes, G2 = this.glow2.geometry.attributes;
    const S = this.shadow.geometry.attributes, Dr = this.dropL.geometry.attributes, P = this.dots.geometry.attributes;
    let n = 0, nd = 0, np = 0, k = 0, prev = null, cx = null, zy = null, held = 0, pen = null;
    for (const f of pts) {
      if (!f) { prev = null; cx = zy = null; continue; }   // 尚未写入：断开
      // X：音色（平滑，形成连续游走）
      const c = centroidNorm(f.centroid);
      cx = cx === null ? c : cx + (c - cx) * 0.15;
      const x = (cx * 2 - 1) * (W / 2);
      // Y：时间
      const z = whole ? -DP / 2 + (f.t / span) * DP : -DP / 2 + ((f.t - (t1 - span)) / span) * DP;
      // Z：音高（无音高时沿用上一个音高）或音调性
      let target, voiced = true;
      if (this.zMode === "pitch") {
        voiced = f.f0 > 0 && f.f0_conf >= 0.5 && f.rms > 0.02;
        if (voiced) held = centroidNorm(f.f0);
        else if (!held) held = c;          // 开头还没有音高时，用音色高度起步
        target = held;
      } else {
        target = f.rms < 0.02 ? 0 : f.tonality;
      }
      zy = zy === null ? target : zy + (target - zy) * 0.3;
      const y = zy * H;
      // 颜色：振幅；无音高的段落向背景色靠拢（变暗）
      const amp = Math.min(1, f.rms * s.settings.gain);
      let [r, g, b] = this.fx === "lightning" ? lightningRgb(amp) : plasmaRgb(amp);
      const kk = voiced ? 0.35 + 0.65 * Math.min(1, f.rms * 1.6) : 0.25;
      r = bg[0] + (r - bg[0]) * kk; g = bg[1] + (g - bg[1]) * kk; b = bg[2] + (b - bg[2]) * kk;
      if (prev && n < MAX) {
        A.position.array.set([prev.x, prev.y, prev.z, x, y, z], n * 6);
        A.color.array.set([prev.r, prev.g, prev.b, r, g, b], n * 6);
        G.position.array.set([prev.x + 0.03, prev.y + 0.03, prev.z, x + 0.03, y + 0.03, z], n * 6);
        G.color.array.set([prev.r, prev.g, prev.b, r, g, b], n * 6);
        if (this.fx === "lightning") {   // 外层紫色光晕（偏移更大）
          G2.position.array.set([prev.x - 0.06, prev.y + 0.05, prev.z + 0.04, x - 0.06, y + 0.05, z + 0.04], n * 6);
          G2.color.array.set([0.45, 0.25, 1.0, 0.45, 0.25, 1.0], n * 6);
        }
        const sh = this.theme === "gray" ? [0.2, 0.21, 0.23] : [r * 0.3, g * 0.3, b * 0.3];
        S.position.array.set([prev.x, 0.01, prev.z, x, 0.01, z], n * 6);
        S.color.array.set([...sh, ...sh], n * 6);
        n++;
      }
      if (k % 4 === 0 && np < MAX && f.rms > 0.03) {        // 线上的亮点
        P.position.array.set([x, y, z], np * 3);
        P.color.array.set([r, g, b], np * 3);
        P.size.array[np] = 0.04 + 0.12 * amp;
        np++;
      }
      if (k % (this.fx === "lightning" ? 14 : 6) === 0 && nd < MAX && f.rms > 0.05) {        // 落地竖线
        Dr.position.array.set([x, y, z, x, 0, z], nd * 6);
        Dr.color.array.set([r, g, b, bg[0], bg[1], bg[2]], nd * 6);
        nd++;
      }
      prev = { x, y, z, r, g, b };
      pen = prev;
      k++;
    }
    // 电弧：笔尖后约半秒（最后 30 段）的线随机抖动
    if (this.fx === "lightning" && n > 0) {
      const jit = 0.03 + 0.12 * Math.min(1, (last ? last.rms : 0) * 1.5);
      const arr = A.position.array;
      for (let i = Math.max(0, n - 30); i < n; i++) {
        const w = (i - (n - 30)) / 30;     // 越靠近笔尖抖得越厉害
        for (let j = 0; j < 6; j++) arr[i * 6 + j] += (Math.random() - 0.5) * jit * w;
      }
    }
    this.path.geometry.setDrawRange(0, n * 2);
    this.glow.geometry.setDrawRange(0, n * 2);
    this.glow2.geometry.setDrawRange(0, this.fx === "lightning" ? n * 2 : 0);
    // 光晕闪烁
    this.glow.material.opacity = this.fx === "lightning" ? 0.22 + Math.random() * 0.25 + this.flash * 0.4 : 0.28;
    this.glow2.material.opacity = this.fx === "lightning" ? 0.1 + Math.random() * 0.15 + this.flash * 0.3 : 0;
    G2.position.needsUpdate = G2.color.needsUpdate = true;
    this.shadow.geometry.setDrawRange(0, this.drops ? n * 2 : 0);
    this.dropL.geometry.setDrawRange(0, this.drops ? nd * 2 : 0);
    this.dots.geometry.setDrawRange(0, np);
    for (const a of [A.position, A.color, G.position, G.color, S.position, S.color, Dr.position, Dr.color, P.position, P.color, P.size]) a.needsUpdate = true;

    this.pen.visible = !!pen;
    if (pen) {
      this.pen.position.set(pen.x, pen.y, pen.z);
      const base = 0.06 + 0.12 * (last ? last.rms : 0);
      this.pen.scale.setScalar(this.fx === "lightning" ? base * (0.8 + Math.random() * 0.6) : base);
      this.pen.material.color.setRGB(...(this.fx === "lightning" ? [0.8, 0.95, 1] : [1, 1, 1]));
    }
    this._bolts(pen, t);
    this.draw();
  }

  /** 新的强声音事件 → 从笔尖劈下一道分叉闪电；更新、淡出已有闪电 */
  _bolts(pen, now) {
    const s = this.store;
    if (s.nodes.length < this.seenNodes) this.seenNodes = 0;   // 清空过
    for (let id = this.seenNodes; id < s.nodes.length; id++) {
      const nd = s.nodes[id];
      if (this.fx === "lightning" && nd && pen && nd.amplitude >= 0.55 && now - this.lastBolt > 0.6) {
        this.bolts.push({ segs: this._makeBolt(pen), born: now, amp: nd.amplitude });
        this.flash = Math.min(0.8, this.flash + 0.25 + 0.4 * nd.amplitude);
        this.lastBolt = now;
      }
    }
    this.seenNodes = s.nodes.length;

    const B = this.boltL.geometry.attributes;
    let n = 0;
    this.bolts = this.bolts.filter((b) => now - b.born < 0.6);
    for (const b of this.bolts) {
      const age = (now - b.born) / 0.6;
      // 亮度：快速衰减 + 随机频闪（像真实闪电的多次回击）
      const k = Math.pow(1 - age, 1.5) * (Math.random() < 0.25 ? 0.3 : 1) * (0.6 + 0.4 * b.amp);
      // 冲击波圆环：半径随时间扩散，亮度衰减
      if (b.segs.ring && n < MAX_BOLT - 40) {
        const [cx, cz] = b.segs.ring, R = 0.2 + age * 3.2, RN = 36, w = 0.6 * (1 - age);
        for (let i = 0; i < RN; i++) {
          const a0 = (i / RN) * Math.PI * 2, a1 = ((i + 1) / RN) * Math.PI * 2;
          B.position.array.set([cx + Math.cos(a0) * R, 0.02, cz + Math.sin(a0) * R, cx + Math.cos(a1) * R, 0.02, cz + Math.sin(a1) * R], n * 6);
          B.color.array.set([0.5 * w, 0.8 * w, w, 0.5 * w, 0.8 * w, w], n * 6);
          n++;
        }
      }
      for (const sg of b.segs) {
        if (n >= MAX_BOLT) break;
        B.position.array.set(sg.p, n * 6);
        const w = sg.w * k;   // 主干更亮，分支更暗
        B.color.array.set([0.75 * w, 0.88 * w, w, 0.75 * w, 0.88 * w, w], n * 6);
        n++;
      }
    }
    this.boltL.geometry.setDrawRange(0, n * 2);
    B.position.needsUpdate = B.color.needsUpdate = true;
  }

  /** 中点位移法生成锯齿状闪电：主干从笔尖落到地面，附带 2–3 条分支 */
  _makeBolt(p) {
    const segs = [];
    const jag = (a, b, depth, disp, w) => {
      let pts = [a, b];
      for (let d = 0; d < depth; d++) {
        const next = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const u = pts[i], v = pts[i + 1];
          const m = [(u[0] + v[0]) / 2 + (Math.random() - 0.5) * disp, (u[1] + v[1]) / 2 + (Math.random() - 0.5) * disp * 0.4,
            (u[2] + v[2]) / 2 + (Math.random() - 0.5) * disp];
          next.push(m, v);
        }
        pts = next;
        disp *= 0.55;
      }
      for (let i = 0; i < pts.length - 1; i++) segs.push({ p: [...pts[i], ...pts[i + 1]], w });
      return pts;
    };
    // 从长方体上方的“天空”劈向轨迹上的笔尖（真正的 3D 方向：上下 + 前后左右都有偏移）
    const start = [p.x + (Math.random() - 0.5) * 4, H + 2.5, p.z + (Math.random() - 0.5) * 4];
    const end = [p.x, p.y, p.z];
    const trunk = jag(start, end, 5, 1.1, 1.0);
    // 落点继续向地面放电一小段
    jag(end, [p.x + (Math.random() - 0.5) * 0.8, 0, p.z + (Math.random() - 0.5) * 0.8], 4, 0.5, 0.6);
    // 地面冲击波圆环（雷鸣）：在 _bolts 里随时间扩散
    segs.ring = [p.x, p.z];
    const nb = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < nb; i++) {
      const from = trunk[2 + Math.floor(Math.random() * (trunk.length - 4))];
      // 分支向四周（x、z 两个方向）斜向下展开
      const ang = Math.random() * Math.PI * 2, len = 1 + Math.random() * 1.8;
      const to = [from[0] + Math.cos(ang) * len, Math.max(0, from[1] - 0.6 - Math.random() * 1.6), from[2] + Math.sin(ang) * len];
      jag(from, to, 4, 0.7, 0.5);
    }
    return segs;
  }

  _hud(whole, span, last) {
    const s = this.store;
    const sig = `${s.title}|${s.birds.length}`;
    if (sig !== this.hudSig) {
      this.hudSig = sig;
      this.q(".sh-name").textContent = `声学轨迹 · ${s.title || "—"}`;
      const cnt = {};
      for (const b of s.birds) { const k = `${b.species[0].common}|${b.species[0].sci}`; cnt[k] = (cnt[k] || 0) + 1; }
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      const [common, sci] = top ? top[0].split("|") : [];
      this.q(".sh-sp").innerHTML = top ? `${common} <i>(${sci})</i>` : "";
    }
    if (last) {
      const voiced = last.f0 > 0 && last.f0_conf >= 0.5 && last.rms > 0.02;
      const zText = this.zMode === "pitch" ? (voiced ? `${noteName(last.f0)} ${last.f0.toFixed(0)} Hz` : "无音高") : `音调性 ${last.tonality.toFixed(2)}`;
      const written = whole ? ` · 已写入 ${Math.min(100, (s.traceCount / Math.max(1, span * 60)) * 100).toFixed(0)}%` : ` · 最近 ${span} s`;
      this.q(".sh-read").textContent = `${last.t.toFixed(1)} s · 音色 ${Math.round(last.centroid)} Hz · ${zText} · 振幅 ${last.rms.toFixed(2)}${written}`;
    }
  }

  onClear() {
    for (const o of [this.path, this.glow, this.glow2, this.shadow, this.dropL, this.dots, this.boltL]) o.geometry.setDrawRange(0, 0);
    this.bolts = []; this.flash = 0; this.seenNodes = 0;
    this.tickSig = this.hudSig = "";
  }
}
