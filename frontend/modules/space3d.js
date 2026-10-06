// 模块：3D 声音空间 —— 音乐学坐标
//
//   X（横向）  声像：立体声中的左右位置，L100 · L50 · C · R50 · R100（混音工程的标准写法）
//   Y（纵深）  时间：音乐的推进，最新的在最前面
//   Z（高度）  音高：音符的基频（后端 YIN 检测），对数刻度 = 音乐的音程关系
//              中间竖立一根“音高标尺”：每个八度的 C 为一级主刻度（C4 · 262 Hz），A4 = 440 Hz 加亮，
//              每个半音一个小刻度；每个八度一层淡淡的水平框，把空间分成音区
//   颜色+大小  力度：pp · p · mp · mf · f · ff
//   无明确音高的声音（噪声、鼓、风）：可选显示为灰色小点，高度用频谱质心（亮度）代替
//   整体按节律慢旋转

import * as THREE from "three";
import { ThreeModule } from "../core/three-base.js";
import { centroidNorm, heatRgb, heatGradient, makePointMaterial, textSprite, pitch, noteName } from "../palette.js";

const SX = 4, SH = 4, SD = 5, MAX = 4000;
const DYN = [["pp", 0], ["p", 0.15], ["mp", 0.3], ["mf", 0.45], ["f", 0.6], ["ff", 0.8]];
const dynamic = (v) => { let d = "pp"; for (const [n, th] of DYN) if (v >= th) d = n; return d; };
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Space3DModule extends ThreeModule {
  static title = "3D 声音空间（音乐坐标）";

  constructor(ctx) {
    super({ body: ctx.body, pos: [10, 6, 11], target: [0, -0.3, 0], background: 0x090c14 });
    this.store = ctx.store;
    this.rotating = true;
    this.spin = 0;
    this.lastNow = null;
    this.snap = true;          // 音符吸附：高度对齐到最近的半音
    this.showUnpitched = true;

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.staticGroup = new THREE.Group();   // 外框、地面、声像轴
    this.pitchGroup = new THREE.Group();    // 音高标尺与音区分层（随音高范围重建）
    this.timeGroup = new THREE.Group();     // 时间刻度（随时间窗重建）
    this.root.add(this.staticGroup, this.pitchGroup, this.timeGroup);
    this._static();

    const pts = (n) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(n), 1));
      g.setDrawRange(0, 0);
      const p = new THREE.Points(g, makePointMaterial());
      p.frustumCulled = false;
      this.root.add(p);
      return p;
    };
    this.points = pts(MAX);          // 有音高的帧
    this.noise = pts(MAX);           // 无音高的帧
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 6), 3));
    lg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX * 6), 3));
    lg.setDrawRange(0, 0);
    this.melody = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.melody.frustumCulled = false;
    this.root.add(this.melody);

    // 叠加文字：当前音符（左上）、坐标说明 + 力度色条（左下）
    this.hud = document.createElement("div");
    this.hud.className = "music-hud";
    this.hud.innerHTML = `
      <div class="mh-now"><b class="mh-note">—</b><span class="mh-hz"></span><span class="mh-dyn"></span></div>
      <div class="mh-legend">
        <div><em>X</em> 声像（左—右）　<em>Y</em> 时间　<em>Z</em> 音高（音符）</div>
        <div class="mh-dynbar"><span>力度</span><i style="background:${heatGradient("to right")}"></i>
          <span class="mh-marks">${DYN.map(([n]) => `<em>${n}</em>`).join("")}</span></div>
      </div>
      <div class="mh-note-hint"></div>`;
    ctx.body.appendChild(this.hud);
    this.q = (s) => this.hud.querySelector(s);

    ctx.tools.innerHTML = `
      <button class="btn mini on" data-k="snap" title="把音高对齐到最近的半音">音符吸附</button>
      <button class="btn mini on" data-k="noise" title="噪声、鼓、风等没有明确音高的声音">无音高声音</button>
      <button class="btn mini on" data-k="rot">⟳ 旋转</button>`;
    ctx.tools.querySelectorAll("button").forEach((b) => b.onclick = () => {
      const k = b.dataset.k;
      if (k === "snap") this.snap = !this.snap;
      if (k === "noise") this.showUnpitched = !this.showUnpitched;
      if (k === "rot") this.rotating = !this.rotating;
      b.classList.toggle("on", k === "snap" ? this.snap : k === "noise" ? this.showUnpitched : this.rotating);
    });
  }

  // ------------------------------------------------------------------ 坐标系
  _lines(group, pts, color, opacity) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
  }

  _label(group, text, x, y, z, px = 24, color = "#8f9cc4", spacing = 0) {
    const s = textSprite(text, color, px, spacing);
    s.position.set(x, y, z);
    group.add(s);
  }

  _static() {
    const g = this.staticGroup;
    // 外框（很淡）+ 地面网格
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * SX, 2 * SH, 2 * SD)),
      new THREE.LineBasicMaterial({ color: 0x2a3558, transparent: true, opacity: 0.55 }));
    g.add(box);
    const gp = [];
    for (let i = 0; i <= 8; i++) { const x = -SX + (i * 2 * SX) / 8; gp.push(x, -SH, -SD, x, -SH, SD); }
    for (let i = 0; i <= 10; i++) { const z = -SD + (i * 2 * SD) / 10; gp.push(-SX, -SH, z, SX, -SH, z); }
    this._lines(g, gp, 0x1d2744, 0.6);
    // X 声像轴：前下沿
    const xp = [];
    for (const [v, t] of [[-1, "L100"], [-0.5, "L50"], [0, "C"], [0.5, "R50"], [1, "R100"]]) {
      const x = v * SX;
      xp.push(x, -SH, SD, x, -SH - 0.18, SD);
      this._label(g, t, x, -SH - 0.5, SD + 0.15, 22, v === 0 ? "#c9d3f5" : "#8f9cc4");
    }
    this._lines(g, [-SX, -SH, SD, SX, -SH, SD, ...xp], 0x9fb0e0, 0.8);
    this._label(g, "X · 声像（左 — 右）", 0, -SH - 1.05, SD + 0.6, 26, "#dfe6ff", 1);
  }

  /** Z 音高标尺（中轴）+ 每个八度一层的水平框；随工具栏的音高范围重建 */
  _pitchRuler() {
    this.pver = pitch.version;
    const g = this.pitchGroup;
    g.clear();
    const y = (hz) => (centroidNorm(hz) * 2 - 1) * SH;
    const lo = Math.ceil(69 + 12 * Math.log2(pitch.min / 440)), hi = Math.floor(69 + 12 * Math.log2(pitch.max / 440));
    const spine = [0, -SH, 0, 0, SH, 0], minor = [], major = [], layers = [];
    for (let m = lo; m <= hi; m++) {
      const yy = y(midiToHz(m)), name = NOTE_NAMES[m % 12];
      if (name === "C") {
        major.push(-0.35, yy, 0, 0.35, yy, 0, 0, yy, -0.35, 0, yy, 0.35);
        // 音区分层：每个八度一层水平框
        layers.push(-SX, yy, -SD, SX, yy, -SD, SX, yy, -SD, SX, yy, SD, SX, yy, SD, -SX, yy, SD, -SX, yy, SD, -SX, yy, -SD);
        const oct = Math.floor(m / 12) - 1;
        this._label(g, `C${oct} · ${Math.round(midiToHz(m))} Hz`, 0.95, yy, 0, 22, "#c9d3f5");
      } else if (m === 69) { // A4 = 440 Hz（标准音）
        major.push(-0.3, yy, 0, 0.3, yy, 0);
        this._label(g, "A4 · 440 Hz", 0.9, yy, 0, 22, "#ffd166");
      } else {
        minor.push(-0.12, yy, 0, 0.12, yy, 0);
      }
    }
    this._lines(g, spine, 0xdfe6ff, 0.75);
    this._lines(g, major, 0xdfe6ff, 0.85);
    this._lines(g, minor, 0x9fb0e0, 0.45);
    this._lines(g, layers, 0x5a6ea8, 0.16);
    this._label(g, "Z · 音高（音符）", 0, SH + 0.55, 0, 26, "#dfe6ff", 1);
  }

  /** Y 时间轴：右下沿，相对时间 */
  _timeAxis() {
    this.win = this.store.settings.windowSec;
    const g = this.timeGroup, w = this.win, step = w <= 10 ? 2 : w <= 20 ? 5 : 10;
    g.clear();
    const tp = [SX, -SH, -SD, SX, -SH, SD];
    for (let r = -w; r <= 0; r += step) {
      const z = ((r + w) / w * 2 - 1) * SD;
      tp.push(SX, -SH, z, SX + 0.18, -SH, z);
      this._label(g, r === 0 ? "现在" : `${r}s`, SX + 0.6, -SH - 0.3, z, 22);
    }
    this._lines(g, tp, 0x9fb0e0, 0.8);
    this._label(g, "Y · 时间 →", SX + 1.2, -SH - 0.95, 0, 26, "#dfe6ff", 1);
  }

  // ------------------------------------------------------------------ 渲染
  render(now) {
    if (this.pver !== pitch.version) this._pitchRuler();
    if (this.win !== this.store.settings.windowSec) this._timeAxis();

    const t = (now ?? performance.now()) / 1000;
    if (this.lastNow !== null && this.rotating) this.spin += Math.min(0.1, t - this.lastNow);
    this.lastNow = t;
    this.root.rotation.y = (this.spin / 90) * Math.PI * 2 + 0.5;
    this.root.rotation.x = THREE.MathUtils.degToRad(5) * Math.sin((this.spin / 30) * Math.PI * 2);

    const s = this.store, last = s.latest(), win = s.settings.windowSec;
    if (last) {
      const t1 = last.t;
      const F = s.window(t1 - win, t1).filter((f) => f.rms > 0.04);
      const stride = Math.max(1, Math.ceil(F.length / MAX));
      const P = this.points.geometry.attributes, N = this.noise.geometry.attributes, M = this.melody.geometry.attributes;
      let np = 0, nn = 0, nm = 0, prev = null;
      for (let i = 0; i < F.length; i += stride) {
        const f = F[i];
        const x = (Math.max(-90, Math.min(90, f.azimuth)) / 90) * SX;
        const z = ((f.t - (t1 - win)) / win * 2 - 1) * SD;
        const age = 1 - 0.6 * ((t1 - f.t) / win);     // 越旧越暗
        const pitched = f.f0 > 0 && f.f0_conf >= 0.5;
        if (pitched) {
          let hz = f.f0;
          if (this.snap) hz = midiToHz(Math.round(69 + 12 * Math.log2(hz / 440)));
          const y = (centroidNorm(hz) * 2 - 1) * SH;
          const [r, g, b] = heatRgb(f.rms);
          P.position.array.set([x, y, z], np * 3);
          P.color.array.set([r * age, g * age, b * age], np * 3);
          P.size.array[np] = 0.07 + 0.3 * f.rms * f.rms + (f.rms > 0.8 ? 0.1 : 0);
          np++;
          // 旋律线：连接时间上相邻、都有音高的帧
          if (prev && f.t - prev.t < 0.12 && nm < MAX) {
            M.position.array.set([prev.x, prev.y, prev.z, x, y, z], nm * 6);
            M.color.array.set([...prev.c, r * age, g * age, b * age], nm * 6);
            nm++;
          }
          prev = { t: f.t, x, y, z, c: [r * age, g * age, b * age] };
        } else {
          prev = null;
          if (this.showUnpitched) {
            const y = (centroidNorm(f.centroid) * 2 - 1) * SH;
            const v = 0.25 * age * (0.4 + f.rms);
            N.position.array.set([x, y, z], nn * 3);
            N.color.array.set([v, v * 1.05, v * 1.15], nn * 3);
            N.size.array[nn] = 0.05 + 0.08 * f.rms;
            nn++;
          }
        }
      }
      this.points.geometry.setDrawRange(0, np);
      this.noise.geometry.setDrawRange(0, nn);
      this.melody.geometry.setDrawRange(0, nm * 2);
      for (const a of [P.position, P.color, P.size, N.position, N.color, N.size, M.position, M.color]) a.needsUpdate = true;

      // 当前音符读数
      const pitched = last.f0 > 0 && last.f0_conf >= 0.5 && last.rms > 0.04;
      this.q(".mh-note").textContent = pitched ? noteName(last.f0) : last.rms > 0.04 ? "无音高" : "—";
      this.q(".mh-hz").textContent = pitched ? `${last.f0.toFixed(1)} Hz · 可信度 ${Math.round(last.f0_conf * 100)}%` : "";
      this.q(".mh-dyn").textContent = last.rms > 0.04 ? dynamic(last.rms) : "";
      const mono = s.meta && s.meta.channels === 1;
      this.q(".mh-note-hint").textContent = mono ? "单声道：声像恒为 C（居中）" : "";
    }
    this.draw();
  }

  onClear() {
    for (const o of [this.points, this.noise, this.melody]) o.geometry.setDrawRange(0, 0);
  }
}
