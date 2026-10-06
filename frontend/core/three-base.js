// 3D 模块的公共基类：每个面板一个渲染器、相机和轨道控制器。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export class ThreeModule {
  constructor({ body, pos = [8, 6, 10], target = [0, 0, 0], fov = 50, background = 0x0a0d16 }) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "fill";
    body.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(background, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 500);
    this.camera.position.set(...pos);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(...target);
    this.controls.enableDamping = true;
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  draw() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
