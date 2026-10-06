// 模块：多尺度分析 3D（参考 Lucio Arese《European robin》中的 MULTI-SCALE ANALYSIS 右图）
//   x = 频谱质心（对数，随工具栏的音高范围）   y = 音调性（0 噪声 → 1 纯音）   z = 时间（旧 → 新）
//   每个有声帧画一根竖线：从地面升到它的音调性高度；颜色 = 振幅（plasma 色带），顶端一个亮点
//   半透明背板 + 三轴刻度（类似科研绘图）；整体按节律慢旋转；可叠加 X/Y/Z 方向指标

import * as THREE from "three";
import { ThreeModule } from "../core/three-base.js";
import { DirectionHUD } from "./direction-hud.js";
import { centroidNorm, pitch, pitchTicks, fmtHz, plasmaRgb, plasmaGradient, makePointMaterial, textSprite } from "../palette.js";

const S = 4, MAX = 4000;
const THEMES = { dark: 0x0b0e17, gray: 0x4a4c52 };

export class MultiScaleModule extends ThreeModule {
  static title = "多尺度分析 3D";

  constructor(ctx) {
    super({ body: ctx.body, pos: [10, 6, 10.5], target: [0, -0.6, 0], background: THEMES.dark });
    this.store = ctx.store;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.rotating = true;
    this.spin = 0;
    this.lastNow = null;
    this.theme = "dark";

    this._panes();
    this.tickGroup = new THREE.Group();
    this.root.add(this.tickGroup);

    // 竖线（底暗顶亮）
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 6), 3));
    lg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX * 6), 3));
    lg.setDrawRange(0, 0);
    this.stems = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.stems.frustumCulled = false;
    this.root.add(this.stems);

    // 顶端亮点
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    pg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    pg.setAttribute("size", new THREE.BufferAttribute(new Float32Array(MAX), 1));
    pg.setDrawRange(0, 0);
    this.tips = new THREE.Points(pg, makePointMaterial());
    this.tips.frustumCulled = false;
    this.root.add(this.tips);

    // X/Y/Z 方向指标（与「3D 声音空间」共用组件）
    this.hud = new DirectionHUD(S);
    this.root.add(this.hud.group);

    // 图例（右上角，横向色条，同参考图）
    const lg2 = document.createElement("div");
    lg2.className = "legend-plasma";
    lg2.innerHTML = `<span>振幅</span><i style="background:${plasmaGradient()}"></i><span class="lr"><em>弱</em><em>强</em></span>`;
    ctx.body.appendChild(lg2);
    this.note = document.createElement("div");
    this.note.className = "corner-stat";
    ctx.body.appendChild(this.note);

    ctx.tools.innerHTML = `
      <button class="btn mini on" data-k="rot">⟳ 节律旋转</button>
      <button class="btn mini on" data-k="hud">XYZ 方向</button>
      <button class="btn mini" data-k="theme">灰色背景</button>`;
    ctx.tools.querySelectorAll("button").forEach((b) => b.onclick = () => {
      const k = b.dataset.k;
      if (k === "rot") this.rotating = !this.rotating;
      if (k === "hud") this.hud.group.visible = !this.hud.group.visible;
      if (k === "theme") {
        this.theme = this.theme === "dark" ? "gray" : "dark";
        this.renderer.setClearColor(THEMES[this.theme], 1);
      }
      b.classList.toggle("on", k === "rot" ? this.rotating : k === "hud" ? this.hud.group.visible : this.theme === "gray");
    });
  }

  /** 三面半透明背板 + 网格 + 坐标轴线（类似 matplotlib 3D） */
  _panes() {
    const paneMat = new THREE.MeshBasicMaterial({ color: 0xb8c0d8, transparent: true, opacity: 0.045,
      side: THREE.DoubleSide, depthWrite: false });
    const pane = (rot, pos) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * S, 2 * S), paneMat);
      m.rotation.set(...rot); m.position.set(...pos); m.renderOrder = -2;
      this.root.add(m);
    };
    pane([0, 0, 0], [0, 0, -S]);               // 后墙
    pane([0, Math.PI / 2, 0], [-S, 0, 0]);     // 左墙
    pane([-Math.PI / 2, 0, 0], [0, -S, 0]);    // 地面

    // 背板网格线
    const pts = [];
    for (let i = 0; i <= 4; i++) {
      const v = -S + (i * 2 * S) / 4;
      pts.push(-S, v, -S, S, v, -S, v, -S, -S, v, S, -S);   // 后墙
      pts.push(-S, v, -S, -S, v, S, -S, -S, v, -S, S, v);   // 左墙
      pts.push(v, -S, -S, v, -S, S, -S, -S, v, S, -S, v);   // 地面
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color: 0xc9cfdf, transparent: true, opacity: 0.08, depthWrite: false })));

    // 三条主轴（亮一些）
    const a = new THREE.BufferGeometry();
    a.setAttribute("position", new THREE.Float32BufferAttribute([
      -S, -S, S, S, -S, S,      // x：频谱质心（前下沿）
      S, -S, -S, S, -S, S,      // z：时间（右下沿）
      -S, -S, -S, -S, S, -S,    // y：音调性（左后竖边）
    ], 3));
    this.root.add(new THREE.LineSegments(a, new THREE.LineBasicMaterial({ color: 0xdfe4f2, transparent: true, opacity: 0.55 })));
  }

  /** 刻度标签：音高范围或时间窗变化时重建 */
  _ticks() {
    this.ver = pitch.version;
    this.win = this.store.settings.windowSec;
    this.tickGroup.clear();
    const add = (text, x, y, z, px = 26, color = "#c9cfdf") => {
      const s = textSprite(text, color, px); s.position.set(x, y, z); this.tickGroup.add(s);
    };
    for (const f of pitchTicks(5)) add(fmtHz(f), (centroidNorm(f) * 2 - 1) * S, -S - 0.35, S + 0.55);
    add("频谱质心 (Hz)", 0, -S - 0.95, S + 1.1, 30, "#e6ebf7");
    const w = this.win, step = w <= 10 ? 2 : w <= 20 ? 5 : 10;
    for (let t = -w; t <= 0; t += step) add(t === 0 ? "现在" : `${t}s`, S + 0.6, -S - 0.35, ((t + w) / w * 2 - 1) * S);
    add("时间", S + 1.5, -S - 0.95, 0, 30, "#e6ebf7");
    for (const v of [0, 0.25, 0.5, 0.75, 1]) add(v.toFixed(2), -S - 0.55, -S + v * 2 * S, -S);
    add("音调性", -S - 0.4, S + 0.6, -S, 30, "#e6ebf7");
  }

  render(now) {
    if (this.ver !== pitch.version || this.win !== this.store.settings.windowSec) this._ticks();

    // 节律旋转：90 s 一圈 + 30 s 周期的 ±8° 俯仰
    const t = (now ?? performance.now()) / 1000;
    if (this.lastNow !== null && this.rotating) this.spin += Math.min(0.1, t - this.lastNow);
    this.lastNow = t;
    this.root.rotation.y = (this.spin / 90) * Math.PI * 2;
    this.root.rotation.x = THREE.MathUtils.degToRad(8) * Math.sin((this.spin / 30) * Math.PI * 2);

    const s = this.store, last = s.latest(), win = s.settings.windowSec;
    if (last) {
      const t1 = last.t;
      let F = s.window(t1 - win, t1).filter((f) => f.rms > 0.04);
      const stride = Math.max(1, Math.ceil(F.length / MAX));
      if (stride > 1) F = F.filter((_, i) => i % stride === 0);

      const L = this.stems.geometry.attributes, P = this.tips.geometry.attributes;
      const lp = L.position.array, lc = L.color.array, pp = P.position.array, pc = P.color.array, ps = P.size.array;
      for (let i = 0; i < F.length; i++) {
        const f = F[i];
        const x = (centroidNorm(f.centroid) * 2 - 1) * S;
        const z = ((f.t - (t1 - win)) / win * 2 - 1) * S;
        const y = -S + f.tonality * 2 * S;
        const [r, g, b] = plasmaRgb(f.rms);
        const k = i * 6;
        lp[k] = x; lp[k + 1] = -S; lp[k + 2] = z;
        lp[k + 3] = x; lp[k + 4] = y; lp[k + 5] = z;
        lc[k] = r * 0.12; lc[k + 1] = g * 0.12; lc[k + 2] = b * 0.12;
        lc[k + 3] = r; lc[k + 4] = g; lc[k + 5] = b;
        const j = i * 3;
        pp[j] = x; pp[j + 1] = y; pp[j + 2] = z;
        pc[j] = r; pc[j + 1] = g; pc[j + 2] = b;
        ps[i] = 0.05 + 0.16 * f.rms;
      }
      this.stems.geometry.setDrawRange(0, F.length * 2);
      this.tips.geometry.setDrawRange(0, F.length);
      for (const a of [L.position, L.color, P.position, P.color, P.size]) a.needsUpdate = true;

      if (this.hud.group.visible) {
        const d = this.hud.update(last.azimuth, last.elevation, last.rms, this.camera);
        const f2 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
        this.note.innerHTML = `方向 <b>X</b> ${f2(d.x)} · <b>Y</b> ${f2(d.y)} · <b>Z</b> ${f2(d.z)}<br>${win}s · ${F.length} 帧`;
      } else {
        this.note.textContent = `${win}s · ${F.length} 帧`;
      }
    }
    this.draw();
  }

  onClear() {
    this.stems.geometry.setDrawRange(0, 0);
    this.tips.geometry.setDrawRange(0, 0);
  }
}
