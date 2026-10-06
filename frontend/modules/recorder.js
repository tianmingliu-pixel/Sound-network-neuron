// 模块：多道分析记录器
//   按时间滚动的多条轨道（最新在右侧），所有轨道共享同一时间轴。
//   扩展方式：在 TRACKS 中加一项 { key, label, weight, draw } 即可新增一条轨道。

import { centroidNorm, heatRgb, heatGradient, pitchCss, pitch, pitchTicks, fmtHz, groupColor, F_MIN, F_MAX } from "../palette.js";

const GUTTER = 84, PAD_R = 10, AXIS_H = 18, GAP = 6;
const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ---------------------------------------------------------------- 轨道定义
// draw(g, frames, rect, x(t), ctx)：rect = {x, y, w, h}
const TRACKS = [
  {
    key: "spec", label: "频谱图", sub: "30Hz–16kHz", weight: 3,
    draw(g, F, r, x, ctx) { ctx.heatmap(g, F, r, x, (f) => f.bands, true); },
  },
  {
    key: "chroma", label: "色度图", sub: "12 音级", weight: 1.7,
    draw(g, F, r, x, ctx) {
      ctx.heatmap(g, F, r, x, (f) => f.chroma, false);
      g.fillStyle = "rgba(170,185,230,.55)";
      g.font = "9px system-ui";
      for (const i of [0, 4, 7, 11]) {
        g.fillText(PITCH_NAMES[i], r.x + 3, r.y + r.h - (i + 0.5) * (r.h / 12) + 3);
      }
    },
  },
  {
    key: "amp", label: "振幅", sub: "RMS", weight: 1,
    draw(g, F, r, x) {
      g.beginPath();
      g.moveTo(x(F[0].t), r.y + r.h);
      for (const f of F) g.lineTo(x(f.t), r.y + r.h - f.rms * r.h);
      g.lineTo(x(F[F.length - 1].t), r.y + r.h);
      g.closePath();
      const grad = g.createLinearGradient(0, r.y + r.h, 0, r.y);
      grad.addColorStop(0, "rgba(34,184,208,.08)");
      grad.addColorStop(1, "rgba(255,211,77,.45)");
      g.fillStyle = grad;
      g.fill();
      ctx_line(g, F, r, x, (f) => f.rms, "rgba(220,240,255,.85)");
    },
  },
  {
    key: "cent", label: "频谱质心", sub: () => `${fmtHz(pitch.min)}–${fmtHz(pitch.max)}Hz`, weight: 1.4,
    draw(g, F, r, x) {
      // 刻度线（随音高范围变化）
      g.font = "9px system-ui";
      for (const f of pitchTicks(4)) {
        const yy = r.y + r.h - centroidNorm(f) * r.h;
        g.fillStyle = "rgba(140,170,255,.10)";
        g.fillRect(r.x, yy, r.w, 1);
        g.fillStyle = "rgba(170,185,230,.5)";
        g.fillText(fmtHz(f), r.x + 3, yy - 2);
      }
      // 点的颜色 = 音高色，透明度 = 响度（安静时质心无意义）
      for (const f of F) {
        if (f.rms < 0.03) continue;
        const v = centroidNorm(f.centroid);
        g.globalAlpha = Math.min(1, 0.25 + f.rms);
        g.fillStyle = pitchCss(v);
        g.fillRect(x(f.t) - 1, r.y + r.h - v * r.h - 1, 2, 2);
      }
      g.globalAlpha = 1;
    },
  },
  {
    key: "ton", label: "音调性", sub: "噪声 → 纯音", weight: 1,
    draw(g, F, r, x) { ctx_line(g, F, r, x, (f) => (f.rms < 0.03 ? 0 : f.tonality), "rgba(110,231,255,.85)"); },
  },
  {
    key: "events", label: "事件", sub: "起始点", weight: 0.8,
    draw(g, F, r, x, ctx) {
      const t0 = F[0].t, t1 = F[F.length - 1].t;
      g.font = "9px system-ui";
      for (const n of ctx.store.nodes) {
        if (!n || n.t < t0 || n.t > t1) continue;
        const xx = x(n.t), h = (0.3 + 0.7 * n.amplitude) * r.h;
        g.fillStyle = pitchCss(centroidNorm(n.centroid));
        g.fillRect(xx, r.y + r.h - h, Math.max(1.5, x(n.t_end) - xx), h);
      }
    },
  },
  {
    key: "recog", label: "识别", sub: "声音 / 鸟种 / 字幕", weight: 1.6,
    draw(g, F, r, x, ctx) {
      const s = ctx.store, t0 = F[0].t, t1 = F[F.length - 1].t, h3 = r.h / 3;
      g.font = "10px system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif";
      g.textBaseline = "middle";
      const span = (a, b, row, color, text) => {
        if (b < t0 || a > t1) return;
        const xa = Math.max(r.x, x(a)), xb = Math.min(r.x + r.w, x(b));
        if (xb - xa < 1) return;
        const y = r.y + row * h3 + 1.5, h = h3 - 3;
        g.fillStyle = color;
        g.globalAlpha = 0.25; g.fillRect(xa, y, xb - xa, h);
        g.globalAlpha = 1; g.fillRect(xa, y, 2, h);
        if (xb - xa > 26 && h > 8) {
          g.save(); g.beginPath(); g.rect(xa, y, xb - xa, h); g.clip();
          g.fillStyle = "#eef2ff"; g.fillText(text, xa + 5, y + h / 2); g.restore();
        }
      };
      // 第 1 行：声音类别（相邻同类合并）
      let cur = null;
      const flush = () => cur && span(cur.t, cur.te, 0, groupColor(cur.l.group), `${cur.l.zh} ${Math.round(cur.l.score * 100)}%`);
      for (const so of s.sounds) {
        const l = so.labels[0];
        if (!l) continue;
        if (cur && cur.l.en === l.en && so.t - cur.te < 2.5) { cur.te = so.t_end; continue; }
        flush(); cur = { t: so.t, te: so.t_end, l };
      }
      flush();
      // 第 2 行：鸟种
      for (const b of s.birds) span(b.t, b.t_end, 1, groupColor("species"), `${b.species[0].sci} · ${b.species[0].common}`);
      // 第 3 行：字幕
      for (const c of s.captions) span(c.t, Math.max(c.t_end, c.t + 0.3), 2, "#ffffff", `[${c.lang_name}] ${c.text}`);
      g.textBaseline = "alphabetic";
    },
  },
];

function ctx_line(g, F, r, x, val, color) {
  g.beginPath();
  F.forEach((f, i) => {
    const px = x(f.t), py = r.y + r.h - val(f) * r.h;
    if (i) g.lineTo(px, py); else g.moveTo(px, py);
  });
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.stroke();
}

// ---------------------------------------------------------------- 模块
export class RecorderModule {
  static title = "多道分析记录";

  constructor({ body, tools, store }) {
    this.store = store;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "fill";
    body.appendChild(this.canvas);
    this.g = this.canvas.getContext("2d");
    this.off = document.createElement("canvas"); // 热图离屏画布
    this.offG = this.off.getContext("2d");
    this.mouseX = null;
    this.frameNo = 0;
    this.hidden = new Set();

    tools.innerHTML = `<div class="legend-heat" title="强弱色带"><i style="background:${heatGradient("to right")}"></i><span>弱 → 强</span></div>`;
    this.canvas.addEventListener("pointermove", (e) => {
      this.mouseX = e.clientX - this.canvas.getBoundingClientRect().left;
    });
    this.canvas.addEventListener("pointerleave", () => { this.mouseX = null; });
  }

  resize(w, h) {
    const dpr = Math.min(devicePixelRatio, 2);
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** 热图：每帧一列，值 → 强弱色带 */
  heatmap(g, F, r, x, get, smooth) {
    const rows = get(F[0])?.length;
    if (!rows) return;
    const n = F.length;
    if (this.off.width !== n || this.off.height !== rows) {
      this.off.width = n; this.off.height = rows;
      this.img = this.offG.createImageData(n, rows);
    }
    const d = this.img.data;
    for (let i = 0; i < n; i++) {
      const v = get(F[i]) || [];
      for (let b = 0; b < rows; b++) {
        const [cr, cg, cb] = heatRgb(v[b] ?? 0);
        const p = ((rows - 1 - b) * n + i) * 4; // 低频在下
        d[p] = cr * 255; d[p + 1] = cg * 255; d[p + 2] = cb * 255; d[p + 3] = 255;
      }
    }
    this.offG.putImageData(this.img, 0, 0);
    g.imageSmoothingEnabled = smooth;
    const x0 = x(F[0].t), x1 = x(F[n - 1].t);
    g.drawImage(this.off, x0, r.y, Math.max(1, x1 - x0), r.h);
  }

  render() {
    if (!this.w || ++this.frameNo % 2) return; // 30 fps 足够
    const g = this.g, W = this.w, H = this.h, s = this.store;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#0a0d16";
    g.fillRect(0, 0, W, H);

    const last = s.latest();
    const win = s.settings.windowSec;
    const t1 = last ? last.t : 0, t0 = t1 - win;
    const plotW = W - GUTTER - PAD_R;
    const x = (t) => GUTTER + ((t - t0) / win) * plotW;
    const F = last ? s.window(t0, t1) : [];

    // 轨道布局
    const tracks = TRACKS.filter((tr) => !this.hidden.has(tr.key));
    const totalW = tracks.reduce((a, tr) => a + tr.weight, 0);
    const avail = H - AXIS_H - GAP * (tracks.length + 1);
    let y = GAP;
    for (const tr of tracks) {
      const h = (avail * tr.weight) / totalW;
      const r = { x: GUTTER, y, w: plotW, h };
      g.fillStyle = "#0e1220";
      g.fillRect(r.x, r.y, r.w, r.h);
      g.save();
      g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
      if (F.length > 1) tr.draw(g, F, r, x, this);
      g.restore();
      g.strokeStyle = "rgba(140,170,255,.14)";
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      g.fillStyle = "#c9d3f5";
      g.font = "11px system-ui, 'PingFang SC', 'Microsoft YaHei'";
      g.fillText(tr.label, 8, r.y + 13);
      if (h > 30) {
        g.fillStyle = "#6f7aa0";
        g.font = "9px system-ui, 'PingFang SC', 'Microsoft YaHei'";
        g.fillText(typeof tr.sub === "function" ? tr.sub() : tr.sub, 8, r.y + 26);
      }
      tr._rect = r;
      y += h + GAP;
    }

    // 时间轴
    g.fillStyle = "#6f7aa0";
    g.font = "10px system-ui";
    const step = win <= 10 ? 1 : win <= 30 ? 5 : 10;
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      if (t < 0) continue;
      const xx = x(t);
      g.fillRect(xx, H - AXIS_H, 1, 4);
      g.fillText(`${t}s`, xx - 6, H - 4);
      g.fillStyle = "rgba(140,170,255,.06)";
      g.fillRect(xx, GAP, 1, H - AXIS_H - GAP);
      g.fillStyle = "#6f7aa0";
    }

    // 悬停读数
    if (this.mouseX !== null && this.mouseX > GUTTER && F.length) {
      const tm = t0 + ((this.mouseX - GUTTER) / plotW) * win;
      const f = F.reduce((a, b) => (Math.abs(b.t - tm) < Math.abs(a.t - tm) ? b : a));
      g.fillStyle = "rgba(255,255,255,.5)";
      g.fillRect(this.mouseX, GAP, 1, H - AXIS_H - GAP);
      const ci = f.chroma ? f.chroma.indexOf(Math.max(...f.chroma)) : -1;
      const text = `${f.t.toFixed(2)}s · 振幅 ${f.rms.toFixed(2)} · ${Math.round(f.centroid)} Hz · 音调性 ${f.tonality.toFixed(2)}` +
        (ci >= 0 && f.rms > 0.03 ? ` · 主音级 ${PITCH_NAMES[ci]}` : "");
      g.font = "11px system-ui, 'PingFang SC', 'Microsoft YaHei'";
      const tw = g.measureText(text).width + 12;
      const bx = Math.min(this.mouseX + 8, W - tw - 4);
      g.fillStyle = "rgba(10,13,22,.9)";
      g.fillRect(bx, GAP + 2, tw, 20);
      g.fillStyle = "#e6ecff";
      g.fillText(text, bx + 6, GAP + 16);
    }

    if (!F.length) {
      g.fillStyle = "#6f7aa0";
      g.font = "12px system-ui, 'PingFang SC', 'Microsoft YaHei'";
      g.fillText("等待音频输入…", GUTTER + 12, H / 2);
    }
  }
}

export const RANGE = [F_MIN, F_MAX];
