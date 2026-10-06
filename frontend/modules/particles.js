// 模块：空间粒子环（v0.1 / v0.2 的粒子视图，作为可选模块保留）
import { ThreeModule } from "../core/three-base.js";
import { SpaceView } from "../viz-space.js";

export class ParticlesModule extends ThreeModule {
  static title = "空间粒子环";

  constructor(ctx) {
    super({ body: ctx.body, pos: [0, 6, 10], target: [0, 0.5, -2], background: 0x05070d });
    this.store = ctx.store;
    this.view = new SpaceView();
    this.scene = this.view.scene;
    this.view.setBandCount(ctx.store.meta?.band_centers.length || 64);
    for (const f of ctx.store.frames.slice(-90)) this.view.pushFrame(f); // 用已有数据补上拖尾
  }

  onReady(meta) { this.view.setBandCount(meta.band_centers.length); }
  onFrame(f) { this.view.pushFrame(f); }
  onClear() { this.view.clear(); }

  render() {
    this.view.update(this.store.settings.gain, 90);
    this.draw();
  }
}
