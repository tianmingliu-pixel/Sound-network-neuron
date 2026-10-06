// 空间粒子视图（v0.1 的粒子环，改为模块）
//   锚点 = 声源方位；环角度 = 频率；径向位移 = 能量；纵深拖尾 = 时间

import * as THREE from "three";
import { bandColor, makeSprite } from "./palette.js";

const MAX_HIST = 180;
export const SOURCE_RADIUS = 6;

export class SpaceView {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05070d, 0.04);
    this.history = [];
    this.smoothAz = 0;
    this.smoothEl = 0;
    this.sprite = makeSprite();
    this.cameraPose = { pos: [0, 6, 10], target: [0, 0.5, -2] };

    const grid = new THREE.GridHelper(40, 40, 0x1c2747, 0x111830);
    grid.position.y = -2;
    this.scene.add(grid);

    const orbit = new THREE.Mesh(
      new THREE.RingGeometry(SOURCE_RADIUS - 0.01, SOURCE_RADIUS + 0.01, 128),
      new THREE.MeshBasicMaterial({ color: 0x2a3a6a, side: THREE.DoubleSide }));
    orbit.rotation.x = -Math.PI / 2;
    orbit.position.y = -1.99;
    this.scene.add(orbit);

    this.listener = new THREE.Mesh(new THREE.OctahedronGeometry(0.25),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
    this.scene.add(this.listener);

    this.core = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.scene.add(this.core);

    this.ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0x6ee7ff, dashSize: 0.2, gapSize: 0.15, transparent: true, opacity: 0.5 }));
    this.scene.add(this.ray);

    this.setBandCount(64);
  }

  setBandCount(nb) {
    if (this.NB === nb) return;
    this.NB = nb;
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); }
    if (this.ring) { this.scene.remove(this.ring); this.ring.geometry.dispose(); }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_HIST * nb * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_HIST * nb * 3), 3));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.14, map: this.sprite, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nb * 3), 3));
    lg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(nb * 3), 3));
    this.ring = new THREE.LineLoop(lg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending }));
    this.ring.frustumCulled = false;
    this.scene.add(this.ring);

    this.colors = Array.from({ length: nb }, (_, b) => bandColor(b / (nb - 1)));
    this.history = [];
  }

  clear() { this.history = []; }

  pushFrame(f) {
    this.smoothAz += (f.azimuth - this.smoothAz) * 0.25;
    this.smoothEl += (f.elevation - this.smoothEl) * 0.25;
    const az = THREE.MathUtils.degToRad(this.smoothAz);
    const el = THREE.MathUtils.degToRad(this.smoothEl);
    const R = SOURCE_RADIUS * Math.min(1.5, Math.max(0.5, f.distance / 2));
    // 听者面向 -Z；方位角为正表示右侧
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const anchor = dir.clone().multiplyScalar(R);
    const u = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    this.history.unshift({ anchor, dir, u, bands: f.bands, rms: f.rms });
    if (this.history.length > MAX_HIST) this.history.length = MAX_HIST;
  }

  update(gain, trailLen) {
    const NB = this.NB, H = this.history;
    const trail = Math.min(trailLen, H.length);
    const pos = this.points.geometry.attributes.position.array;
    const col = this.points.geometry.attributes.color.array;
    const center = new THREE.Vector3();
    let p = 0;
    for (let k = 0; k < trail; k++) {
      const h = H[k];
      const fade = Math.pow(1 - k / trail, 1.6);
      center.copy(h.anchor).addScaledVector(h.dir, k * 0.09);
      for (let b = 0; b < NB; b++) {
        const e = h.bands[b] ?? 0;
        const th = (b / NB) * Math.PI * 2;
        const r = 0.35 + e * gain * 1.5;
        const cx = Math.cos(th) * r, cy = Math.sin(th) * r;
        pos[p] = center.x + h.u.x * cx;
        pos[p + 1] = center.y + cy;
        pos[p + 2] = center.z + h.u.z * cx;
        const c = this.colors[b], it = fade * (0.15 + e * 0.85);
        col[p] = c.r * it; col[p + 1] = c.g * it; col[p + 2] = c.b * it;
        p += 3;
      }
    }
    this.points.geometry.setDrawRange(0, trail * NB);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    const show = H.length > 0;
    this.ring.visible = this.core.visible = this.ray.visible = show;
    if (show) {
      const h = H[0];
      const lp = this.ring.geometry.attributes.position.array;
      const lc = this.ring.geometry.attributes.color.array;
      for (let b = 0; b < NB; b++) {
        const th = (b / NB) * Math.PI * 2;
        const r = 0.35 + (h.bands[b] ?? 0) * gain * 1.5;
        lp[b * 3] = h.anchor.x + h.u.x * Math.cos(th) * r;
        lp[b * 3 + 1] = h.anchor.y + Math.sin(th) * r;
        lp[b * 3 + 2] = h.anchor.z + h.u.z * Math.cos(th) * r;
        const c = this.colors[b];
        lc[b * 3] = c.r; lc[b * 3 + 1] = c.g; lc[b * 3 + 2] = c.b;
      }
      this.ring.geometry.attributes.position.needsUpdate = true;
      this.ring.geometry.attributes.color.needsUpdate = true;
      this.core.position.copy(h.anchor);
      this.core.scale.setScalar(0.12 + h.rms * 0.35);
      this.ray.geometry.attributes.position.setXYZ(1, h.anchor.x, h.anchor.y, h.anchor.z);
      this.ray.geometry.attributes.position.needsUpdate = true;
      this.ray.computeLineDistances();
    }
    this.listener.rotation.y += 0.01;
  }
}
