// 模块：声学映射网络（声学流形）
//   节点 = 声音事件；颜色 = 音高（频谱质心，低 → 高）；大小 = 振幅
//   细线：白色 = 时序边，彩色淡线 = 相似边
//   连线随“年龄”变化：刚连上时粗而亮（多层叠加），之后逐渐变细、褪色，只留淡淡的痕迹；
//   年龄按图里最新事件的时间计算（回放 / 跳转时不会乱闪）。节点也随年龄轻微变暗。
//   坐标：固定特征轴（质心 / 振幅 / 音调性）或冻结 PCA

import * as THREE from "three";
import { ThreeModule } from "../core/three-base.js";
import { centroidNorm, pitch, pitchColor, pitchGradient, pitchTicks, fmtHz, noteName, textSprite, F_MIN, F_MAX } from "../palette.js";

const MAX_NODES = 3000, MAX_EDGES = MAX_NODES * 3, S = 4;
const AXIS = { axes: ["频谱质心 (log)", "振幅", "音调性"], pca: ["PC1", "PC2", "PC3"] };

export class ManifoldModule extends ThreeModule {
  static title = "声学映射网络";

  constructor(ctx) {
    super({ body: ctx.body, pos: [7.5, 4.5, 9.5], target: [0, -0.3, 0], background: 0x0c0f18 });
    this.store = ctx.store;
    this.hooks = ctx.hooks;
    this.cur = [];
    this.col = [];           // 节点音高色（缓存）
    this.white = new THREE.Color(1, 1, 1);
    this.activeId = -1;
    this.mode = ctx.store.settings.coord;

    // 坐标框（极淡）
    this.scene.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * S, 2 * S, 2 * S)),
      new THREE.LineBasicMaterial({ color: 0x232c48, transparent: true, opacity: 0.5 })));
    this.labels = [];
    this._labels();

    // 节点
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_NODES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    // 细线：时序边（顶点色 = 两端音高色，偏白）、相似边（更淡）
    this.temporal = this._lines(0.42);
    this.similar = this._lines(0.13);
    this.fresh = this._lines(0.9);    // 新连线：两层偏移叠加，看起来更粗更亮
    this.fresh2 = this._lines(0.45);

    this.halo = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }));
    this.halo.visible = false;
    this.scene.add(this.halo);

    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this._c = new THREE.Color(); this._zero = new THREE.Vector3();

    this._colorbar(ctx.body);
    this._tools(ctx.tools);
    this._picking(ctx.body);

    // 切换到本模块时，用仓库里已有的数据重建
    ctx.store.nodes.forEach((n) => n && this._add(n));
  }

  // ---------------------------------------------------------------- 界面
  _colorbar(body) {
    this.bar = document.createElement("div");
    this.bar.className = "colorbar";
    body.appendChild(this.bar);
    this._drawColorbar();
    this.tip = document.createElement("div");
    this.tip.className = "tooltip";
    this.tip.hidden = true;
    body.appendChild(this.tip);
    this.stat = document.createElement("div");
    this.stat.className = "corner-stat";
    body.appendChild(this.stat);
  }

  /** 色条：刻度随音高范围变化，范围越窄刻度越密；每个刻度附音名 */
  _drawColorbar() {
    this.ver = pitch.version;
    const modeName = { fixed: "固定范围", auto: "自适应", custom: "自定义" }[pitch.mode];
    this.bar.innerHTML = `
      <div class="cb-title">音高（频谱质心）</div>
      <div class="cb-body">
        <div class="cb-ramp" style="background:${pitchGradient("to top")}"></div>
        <div class="cb-ticks">${pitchTicks(10).map((f) =>
          `<span style="top:${100 - centroidNorm(f) * 100}%">${fmtHz(f)}<em>${noteName(f)}</em></span>`).join("")}</div>
      </div>
      <div class="cb-foot">${fmtHz(pitch.min)}–${fmtHz(pitch.max)} Hz<br>${modeName}</div>`;
  }

  /** 色带或范围变化后：重新给所有节点着色 */
  _recolor() {
    for (const n of this.store.nodes) {
      if (!n || n.id >= MAX_NODES) continue;
      this.col[n.id] = pitchColor(centroidNorm(n.centroid));
      this.mesh.setColorAt(n.id, this.col[n.id]);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this._drawColorbar();
  }

  _tools(tools) {
    tools.innerHTML = `
      <div class="seg mini" role="group" aria-label="坐标">
        <button data-c="axes">固定轴</button><button data-c="pca">PCA</button>
      </div>`;
    const btns = tools.querySelectorAll("button");
    const sync = () => btns.forEach((b) => b.classList.toggle("on", b.dataset.c === this.mode));
    btns.forEach((b) => b.onclick = () => {
      this.mode = b.dataset.c;
      this.store.settings.coord = this.mode;
      this._labels();
      sync();
    });
    sync();
  }

  _labels() {
    this.labels.forEach((s) => this.scene.remove(s));
    const [a, b, c] = AXIS[this.mode].map((t) => textSprite(`${t} →`, "#7f8bb3", 34));
    a.position.set(0, -S - 0.45, S + 0.3);
    b.position.set(-S - 0.7, 0, S + 0.3);
    c.position.set(S + 0.7, -S - 0.45, 0);
    this.labels = [a, b, c];
    this.labels.forEach((s) => this.scene.add(s));
  }

  _picking(body) {
    const ray = new THREE.Raycaster(), m = new THREE.Vector2();
    const pick = (ev) => {
      if (!this.mesh.count) return null;
      const r = this.canvas.getBoundingClientRect();
      m.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(m, this.camera);
      this.mesh.computeBoundingSphere();
      const hit = ray.intersectObject(this.mesh, false)[0];
      return hit ? this.store.nodes[hit.instanceId] ?? null : null;
    };
    this.canvas.addEventListener("pointermove", (ev) => {
      const n = pick(ev);
      this.tip.hidden = !n;
      if (!n) return;
      const r = body.getBoundingClientRect();
      this.tip.style.left = `${ev.clientX - r.left + 12}px`;
      this.tip.style.top = `${ev.clientY - r.top + 12}px`;
      this.tip.textContent =
        `#${n.id} · ${n.t.toFixed(2)} s · ${Math.round(n.centroid)} Hz · 振幅 ${n.amplitude.toFixed(2)} · 音调性 ${n.tonality.toFixed(2)}`;
    });
    this.canvas.addEventListener("pointerleave", () => { this.tip.hidden = true; });
    this.canvas.addEventListener("click", (ev) => {
      const n = pick(ev);
      if (n) { this.activeId = n.id; this.hooks.seek?.(n.t); }
    });
  }

  _lines(opacity) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_EDGES * 6), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_EDGES * 6), 3));
    g.setDrawRange(0, 0);
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    l.frustumCulled = false;
    this.scene.add(l);
    return l;
  }

  // ---------------------------------------------------------------- 数据
  _target(n) {
    if (this.mode === "pca" && n.pca) return new THREE.Vector3(n.pca[0], n.pca[1], n.pca[2]);
    // 固定轴：x 按当前音高范围重新计算，压缩范围后节点在 x 方向也会拉开
    return new THREE.Vector3((centroidNorm(n.centroid) * 2 - 1) * S, n.axes[1], n.axes[2]);
  }

  _add(n) {
    if (n.id >= MAX_NODES) return;
    this.cur[n.id] = this._target(n);
    this.col[n.id] = pitchColor(centroidNorm(n.centroid));
    this.mesh.setColorAt(n.id, this.col[n.id]);
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = Math.max(this.mesh.count, n.id + 1);
    this.activeId = n.id;
  }

  onEvent(node) { this._add(node); }
  onClear() { this.fresh.geometry.setDrawRange(0, 0); this.fresh2.geometry.setDrawRange(0, 0); this.cur = []; this.col = []; this.mesh.count = 0; this.activeId = -1; }

  // ---------------------------------------------------------------- 渲染
  render() {
    if (this.ver !== pitch.version) this._recolor();
    const nodes = this.store.nodes;
    for (let i = 0; i < this.mesh.count; i++) {
      const n = nodes[i];
      if (!n || !this.cur[i]) { this._s.set(0, 0, 0); this._m.compose(this._zero, this._q, this._s); this.mesh.setMatrixAt(i, this._m); continue; }
      this.cur[i].lerp(this._target(n), 0.12);
      const r = 0.035 + 0.13 * n.amplitude; // 节点小一些，让线路更清楚
      this._s.set(r, r, r);
      this._m.compose(this.cur[i], this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    // 线路：年龄 = 最新事件时间 − 这条边终点的时间
    let tLast = 0;
    for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i]) { tLast = nodes[i].t; break; }
    const FADE = 8, FRESH = 2;       // 约 8 s 褪到底；2 s 内算“新连线”
    const T = this.temporal.geometry.attributes, Sm = this.similar.geometry.attributes;
    const Fr = this.fresh.geometry.attributes, Fr2 = this.fresh2.geometry.attributes;
    let ti = 0, si = 0, fi = 0;
    for (const [a, b, type] of this.store.edges) {
      const A = this.cur[a], B = this.cur[b], na = nodes[a], nb = nodes[b];
      if (!A || !B || !na || !nb || !this.col[a] || !this.col[b]) continue;
      const P = type === 0 ? T : Sm, k = type === 0 ? ti : si;
      if (k >= MAX_EDGES * 6) continue;
      const age = Math.max(0, tLast - Math.max(na.t, nb.t));
      const fade = 0.12 + 0.88 * Math.exp(-age / FADE);   // 褪色：最终保留 12% 的淡痕
      const pa = P.position.array, ca = P.color.array;
      pa[k] = A.x; pa[k + 1] = A.y; pa[k + 2] = A.z; pa[k + 3] = B.x; pa[k + 4] = B.y; pa[k + 5] = B.z;
      // 时序边偏白（与音高色混合 60%），相似边用音高色
      const mix = type === 0 ? 0.6 : 0;
      this._c.copy(this.col[a]).lerp(this.white, mix).multiplyScalar(fade);
      ca[k] = this._c.r; ca[k + 1] = this._c.g; ca[k + 2] = this._c.b;
      const ar = this._c.r, ag = this._c.g, ab = this._c.b;
      this._c.copy(this.col[b]).lerp(this.white, mix).multiplyScalar(fade);
      ca[k + 3] = this._c.r; ca[k + 4] = this._c.g; ca[k + 5] = this._c.b;
      // 新连线：再叠两层轻微偏移的线 → 视觉上更粗，随年龄变细直到消失
      if (age < FRESH && fi < MAX_EDGES * 6) {
        const w = 1 - age / FRESH, o = 0.025;
        for (const [L2, d] of [[Fr, o], [Fr2, -o]]) {
          const fp = L2.position.array, fc = L2.color.array;
          fp[fi] = A.x + d; fp[fi + 1] = A.y + d; fp[fi + 2] = A.z; fp[fi + 3] = B.x + d; fp[fi + 4] = B.y + d; fp[fi + 5] = B.z;
          fc[fi] = ar * w; fc[fi + 1] = ag * w; fc[fi + 2] = ab * w;
          fc[fi + 3] = this._c.r * w; fc[fi + 4] = this._c.g * w; fc[fi + 5] = this._c.b * w;
        }
        fi += 6;
      }
      if (type === 0) ti += 6; else si += 6;
    }
    // 节点也随年龄轻微变暗（每 6 帧更新一次）
    if ((this.tick = (this.tick || 0) + 1) % 6 === 0) {
      for (let i = 0; i < this.mesh.count; i++) {
        const nd = nodes[i];
        if (!nd || !this.col[i]) continue;
        const f = 0.45 + 0.55 * Math.exp(-Math.max(0, tLast - nd.t) / (FADE * 2));
        this.mesh.setColorAt(i, this._c.copy(this.col[i]).multiplyScalar(f));
      }
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    for (const [L, n] of [[this.temporal, ti], [this.similar, si], [this.fresh, fi], [this.fresh2, fi]]) {
      L.geometry.setDrawRange(0, n / 3);
      L.geometry.attributes.position.needsUpdate = true;
      L.geometry.attributes.color.needsUpdate = true;
    }

    // 播放到的节点（回放时跟随）
    const t = this.store.time;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n && n.t <= t + 0.02) { if (t - n.t_end < 0.35) this.activeId = i; break; }
    }
    const act = nodes[this.activeId];
    this.halo.visible = !!(act && this.cur[this.activeId]);
    if (this.halo.visible) {
      this.halo.position.copy(this.cur[this.activeId]);
      this.halo.scale.setScalar((0.09 + 0.16 * act.amplitude) * (1 + 0.15 * Math.sin(performance.now() / 120)));
    }

    const count = nodes.filter(Boolean).length;
    this.stat.textContent = `${count} 个事件 · ${this.store.edges.length} 条边` +
      (this.mode === "pca" && !this.store.pcaReady ? ` · PCA 学习中 ${Math.min(count, 24)}/24（暂用固定轴）` : "");
    this.draw();
  }
}

export const PITCH_RANGE = [F_MIN, F_MAX];
