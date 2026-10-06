// 模块：振幅 × 频谱质心 散点（参考图 MULTI-SCALE ANALYSIS 左图）
//   x = 频谱质心（对数，随音高范围）  y = 振幅  颜色 = 音调性（深绿 → 青绿）
//   时间窗内每个有声帧一个点，越旧越淡；最新一帧用白圈标出

import { centroidNorm, pitch, pitchTicks, fmtHz, tonalCss, tonalGradient } from "../palette.js";

export class ScatterModule {
  static title = "振幅 × 质心散点";

  constructor({ body, tools, store }) {
    this.store = store;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "fill";
    body.appendChild(this.canvas);
    this.g = this.canvas.getContext("2d");
    this.n = 0;
    this.gray = false;
    tools.innerHTML = `
      <div class="legend-heat"><span>音调性</span><i style="background:${tonalGradient()}"></i><span>噪声 → 纯音</span></div>
      <button class="btn mini" data-k="theme">灰色背景</button>`;
    tools.querySelector("[data-k=theme]").onclick = (e) => {
      this.gray = !this.gray;
      e.target.classList.toggle("on", this.gray);
    };
  }

  resize(w, h) {
    const dpr = Math.min(devicePixelRatio, 2);
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render() {
    if (!this.w || ++this.n % 2) return;
    const g = this.g, W = this.w, H = this.h, s = this.store;
    const L = 58, R = 18, T = 16, B = 42, pw = W - L - R, ph = H - T - B;
    g.fillStyle = this.gray ? "#4a4c52" : "#0a0d16";
    g.fillRect(0, 0, W, H);

    // 坐标轴与网格
    const axis = this.gray ? "rgba(235,238,245,.8)" : "rgba(200,210,240,.55)";
    const grid = this.gray ? "rgba(235,238,245,.12)" : "rgba(140,170,255,.08)";
    g.font = "10px system-ui, 'PingFang SC', 'Microsoft YaHei'";
    g.fillStyle = axis;
    for (const f of pitchTicks(7)) {
      const x = L + centroidNorm(f) * pw;
      g.fillStyle = grid; g.fillRect(x, T, 1, ph);
      g.fillStyle = axis; g.fillText(fmtHz(f), x - 8, T + ph + 14);
    }
    for (let i = 0; i <= 5; i++) {
      const v = i / 5, y = T + ph - v * ph;
      g.fillStyle = grid; g.fillRect(L, y, pw, 1);
      g.fillStyle = axis; g.fillText(v.toFixed(1), L - 26, y + 3);
    }
    g.strokeStyle = axis; g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, T); g.lineTo(L, T + ph); g.lineTo(L + pw, T + ph); g.stroke();
    g.font = "11px system-ui, 'PingFang SC', 'Microsoft YaHei'";
    g.fillText(`频谱质心 (Hz) · ${fmtHz(pitch.min)}–${fmtHz(pitch.max)}`, L + pw / 2 - 70, H - 8);
    g.save(); g.translate(16, T + ph / 2 + 16); g.rotate(-Math.PI / 2); g.fillText("振幅", 0, 0); g.restore();

    // 散点
    const last = s.latest();
    if (!last) return;
    const win = s.settings.windowSec, t1 = last.t;
    const F = s.window(t1 - win, t1);
    for (const f of F) {
      if (f.rms < 0.03) continue;
      const age = (t1 - f.t) / win;
      g.globalAlpha = 0.85 - 0.6 * age;
      g.fillStyle = tonalCss(f.tonality);
      g.fillRect(L + centroidNorm(f.centroid) * pw - 1.5, T + ph - f.rms * ph - 1.5, 3, 3);
    }
    g.globalAlpha = 1;
    if (last.rms >= 0.03) {
      g.strokeStyle = "#fff";
      g.beginPath();
      g.arc(L + centroidNorm(last.centroid) * pw, T + ph - last.rms * ph, 6, 0, Math.PI * 2);
      g.stroke();
    }
  }
}
