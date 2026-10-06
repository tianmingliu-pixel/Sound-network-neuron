// 声音方向指标：X / Y / Z 三块半透明长方形，隐约贴在坐标框的三面背景墙上，
// 每块显示一个方向分量的数值与刻度条；中心有方向罗盘（箭头 + 投影虚线）。
//
//   X = 左右  sin(方位)·cos(仰角)     右为 +
//   Y = 上下  sin(仰角)               上为 +
//   Z = 前后  cos(方位)·cos(仰角)     前为 +（朝向默认相机一侧）
//
// 双声道只能估计左右方位：仰角恒为 0（Y = 0），前后无法区分，默认声源在前方。
// 接入麦克风阵列 + SELD 模型后，这里会自动显示真实的三维方向。

import * as THREE from "three";
import { heatColor } from "../palette.js";

const AXES = {
  x: { letter: "X", caption: "左  ←  →  右", tint: [255, 128, 128] },
  y: { letter: "Y", caption: "下  ↓  ↑  上", tint: [128, 255, 170] },
  z: { letter: "Z", caption: "后  ←  →  前", tint: [128, 184, 255] },
};

export class DirectionHUD {
  constructor(S) {
    this.S = S;
    this.group = new THREE.Group();
    this.dir = new THREE.Vector3(0, 0, 1);
    this.level = 0;
    this.panels = {};

    const W = 2 * S * 0.8, H = 2 * S * 0.38;
    const place = {
      x: { pos: [-S + 0.03, S * 0.48, 0], rot: [0, Math.PI / 2, 0] },
      y: { pos: [0, -S + 0.03, -S * 0.48], rot: [-Math.PI / 2, 0, 0] },
      z: { pos: [0, S * 0.48, -S + 0.03], rot: [0, 0, 0] },
    };
    for (const k of ["x", "y", "z"]) {
      const canvas = document.createElement("canvas");
      canvas.width = 512; canvas.height = 244;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5,
          depthWrite: false, side: THREE.DoubleSide }));
      mesh.position.set(...place[k].pos);
      mesh.rotation.set(...place[k].rot);
      mesh.renderOrder = -1; // 先画，作为背景
      this.group.add(mesh);
      this.panels[k] = { canvas, g: canvas.getContext("2d"), tex, mesh,
        normal: new THREE.Vector3(0, 0, 1), shown: null }; // 平面的局部法线
      this._drawPanel(k, 0);
    }

    // 中心方向罗盘
    const R = this.R = S * 0.55;
    this.compass = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 12),
      new THREE.MeshBasicMaterial({ color: 0x7f8bb3, wireframe: true, transparent: true, opacity: 0.05, depthWrite: false }));
    this.group.add(this.compass);
    const axisLine = (to, color) => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...to.map((v) => -v)), new THREE.Vector3(...to)]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }));
      this.group.add(l);
    };
    axisLine([R, 0, 0], 0xff8080); axisLine([0, R, 0], 0x80ffaa); axisLine([0, 0, R], 0x80b8ff);

    this.arrowMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    this.arrow = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, R)]), this.arrowMat);
    this.group.add(this.arrow);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }));
    this.group.add(this.head);

    // 箭头尖端 → 三面墙的投影虚线
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(18), 3));
    this.proj = new THREE.LineSegments(pg, new THREE.LineDashedMaterial({
      color: 0xaab6e0, dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.35, depthWrite: false }));
    this.group.add(this.proj);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** 输入当前帧：方位角、仰角（度）、响度 0..1 */
  update(azDeg, elDeg, rms, camera) {
    // 用普通数值计算方向（平滑 + 归一化），再写入 three.js 向量
    const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
    const d = this.d || (this.d = { x: 0, y: 0, z: 1 });
    if (rms > 0.04) {
      const tx = Math.sin(az) * Math.cos(el), ty = Math.sin(el), tz = Math.cos(az) * Math.cos(el);
      d.x += (tx - d.x) * 0.15; d.y += (ty - d.y) * 0.15; d.z += (tz - d.z) * 0.15;
      const n = Math.hypot(d.x, d.y, d.z) || 1;
      d.x /= n; d.y /= n; d.z /= n;
    }
    this.dir.set(d.x, d.y, d.z);
    this.level += (rms - this.level) * 0.1;

    // 箭头与锥头
    const tip = this.dir.clone().multiplyScalar(this.R);
    const pos = this.arrow.geometry.attributes.position;
    pos.setXYZ(1, tip.x, tip.y, tip.z); pos.needsUpdate = true;
    this.head.position.copy(tip);
    this.head.quaternion.setFromUnitVectors(this._up, this.dir);
    const c = heatColor(Math.max(0.25, this.level));
    this.arrowMat.color.copy(c); this.head.material.color.copy(c);

    // 投影虚线：尖端 → x=-S 墙、y=-S 地面、z=-S 墙
    const S = this.S, p = this.proj.geometry.attributes.position.array;
    const seg = (i, x, y, z) => { p.set([tip.x, tip.y, tip.z, x, y, z], i * 6); };
    seg(0, -S, tip.y, tip.z); seg(1, tip.x, -S, tip.z); seg(2, tip.x, tip.y, -S);
    this.proj.geometry.attributes.position.needsUpdate = true;
    this.proj.computeLineDistances();

    // 面板：数值变化时重绘；“隐隐约约”的呼吸透明度随响度变化
    const breathe = 0.5 + 0.5 * Math.sin(performance.now() / 1600);
    const vals = { x: d.x, y: d.y, z: d.z };
    for (const k of ["x", "y", "z"]) {
      const P = this.panels[k];
      if (P.shown === null || Math.abs(vals[k] - P.shown) > 0.01) this._drawPanel(k, vals[k]);
      P.mesh.material.opacity = 0.22 + 0.18 * breathe + 0.35 * this.level;
      // 从背面看时水平翻转贴图，文字不会镜像
      const n = P.normal.clone().transformDirection(P.mesh.matrixWorld);
      const toCam = camera.position.clone().sub(P.mesh.getWorldPosition(new THREE.Vector3()));
      const back = n.dot(toCam) < 0;
      if (back !== P.flipped) {
        P.flipped = back;
        P.tex.repeat.x = back ? -1 : 1;
        P.tex.offset.x = back ? 1 : 0;
        P.tex.needsUpdate = true;
      }
    }
    return vals;
  }

  _drawPanel(k, v) {
    const P = this.panels[k], g = P.g, { letter, caption, tint } = AXES[k];
    const [r, gg, b] = tint, W = P.canvas.width, H = P.canvas.height;
    const rgba = (a) => `rgba(${r},${gg},${b},${a})`;
    g.clearRect(0, 0, W, H);
    // 半透明长方形
    g.fillStyle = rgba(0.09);
    g.fillRect(0, 0, W, H);
    g.strokeStyle = rgba(0.45);
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, W - 3, H - 3);
    // 字母 + 数值
    g.fillStyle = rgba(0.95);
    g.font = "700 116px system-ui, sans-serif";
    g.textBaseline = "alphabetic";
    g.fillText(letter, 26, 128);
    g.font = "600 86px ui-monospace, Menlo, Consolas, monospace";
    g.fillStyle = "rgba(235,242,255,.95)";
    g.fillText(`${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`, 168, 122);
    // 说明
    g.font = "28px system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif";
    g.fillStyle = rgba(0.75);
    g.fillText(caption, 30, 178);
    // 刻度条 -1 … 0 … +1
    const x0 = 30, x1 = W - 30, y = 210, xm = (x0 + x1) / 2;
    g.fillStyle = rgba(0.3);
    g.fillRect(x0, y - 2, x1 - x0, 4);
    g.fillRect(xm - 1, y - 12, 2, 24);
    g.fillStyle = rgba(0.85);
    const xv = xm + v * (x1 - x0) / 2;
    g.fillRect(Math.min(xm, xv), y - 4, Math.abs(xv - xm), 8);
    g.beginPath(); g.arc(xv, y, 10, 0, Math.PI * 2); g.fill();
    P.tex.needsUpdate = true;
    P.shown = v;
  }
}
