// 共享配色
//   音高色带 PITCH：声音从低到高，可选 6 色 / 12 色光谱 / Turbo 连续光谱，范围可压缩
//   强弱色带 HEAT ：能量从弱到强   深蓝 → 青 → 白 → 金（峰值）
import * as THREE from "three";

export const PITCH_PALETTES = {
  classic6: { name: "6 色", stops: ["#3b5bff", "#8b4dff", "#ff4fd8", "#ff4a5a", "#ffa62e", "#b6ff4a"] },
  spectral12: { name: "12 色光谱", stops: [
    "#2a1b8f", "#3b3bff", "#2f7bff", "#20b6ff", "#1fe0c8", "#36e07a",
    "#9be22f", "#e6e02a", "#ffb02e", "#ff6a2e", "#ff3b6b", "#ff4fd8"] },
  turbo: { name: "Turbo 连续", stops: [
    "#30123b", "#4145ab", "#4675ed", "#39a2fc", "#1bcfd4", "#24eca6", "#61fc6c", "#a4fc3b",
    "#d1e834", "#f3c63a", "#fe9b2d", "#f36315", "#d93806", "#b11901", "#7a0402"] },
};
export const HEAT_STOPS = ["#0a1a3a", "#0f5c7a", "#22b8d0", "#d8f7ff", "#ffd34d"];

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const HEAT_RGB = HEAT_STOPS.map(hexToRgb);

/** 音高映射的全局状态。version 每次变化 +1，模块据此重新着色 / 重建刻度 */
export const pitch = {
  palette: "spectral12",
  stops: PITCH_PALETTES.spectral12.stops,
  rgb: PITCH_PALETTES.spectral12.stops.map(hexToRgb),
  mode: "fixed",          // fixed | auto | custom
  min: 100, max: 10000,   // Hz
  version: 0,
};

export function setPitchPalette(key) {
  const p = PITCH_PALETTES[key];
  if (!p || key === pitch.palette) return;
  pitch.palette = key;
  pitch.stops = p.stops;
  pitch.rgb = p.stops.map(hexToRgb);
  pitch.version++;
}

export function setPitchRange(min, max) {
  min = Math.max(20, Math.min(min, 19000));
  max = Math.min(20000, Math.max(max, min * 1.25)); // 至少约 4 个半音的跨度
  if (Math.abs(min - pitch.min) < 0.5 && Math.abs(max - pitch.max) < 0.5) return;
  pitch.min = min; pitch.max = max;
  pitch.version++;
}

function sample(stops, x) {
  const t = Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** 0..1 → [r,g,b]（0..1），供 ImageData / 顶点颜色直接使用 */
export const pitchRgb = (x) => sample(pitch.rgb, x);
export const heatRgb = (x) => sample(HEAT_RGB, x);

export const pitchColor = (x) => new THREE.Color(...pitchRgb(x));
export const heatColor = (x) => new THREE.Color(...heatRgb(x));

const css = ([r, g, b]) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
export const pitchCss = (x) => css(pitchRgb(x));
export const heatCss = (x) => css(heatRgb(x));

/** CSS 渐变，用于色条图例（方向：to top = 下低上高） */
export const pitchGradient = (dir = "to top") => `linear-gradient(${dir}, ${pitch.stops.join(",")})`;
export const heatGradient = (dir = "to top") => `linear-gradient(${dir}, ${HEAT_STOPS.join(",")})`;

/** 频谱质心 (Hz) → 0..1（当前音高范围内，对数刻度；超出范围的值贴边） */
export const F_MIN = 100, F_MAX = 10000; // 默认范围
export function centroidNorm(hz) {
  return Math.min(1, Math.max(0, Math.log(Math.max(hz, 1) / pitch.min) / Math.log(pitch.max / pitch.min)));
}

export const fmtHz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k` : `${Math.round(f)}`);

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** 频率 → 最近的音名，例如 440 → "A4" */
export function noteName(f) {
  const m = Math.round(69 + 12 * Math.log2(f / 440));
  return `${NOTE[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** 当前范围内的刻度（Hz）：优先选“整齐”的数值，范围越窄刻度越密 */
export function pitchTicks(maxCount = 9) {
  const LEVELS = [[1], [1, 3], [1, 2, 5], [1, 1.5, 2, 3, 5, 7], [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9]];
  const inRange = (f) => f >= pitch.min * 0.999 && f <= pitch.max * 1.001;
  let best = [];
  for (const level of LEVELS) {
    const t = [];
    for (let d = 10; d <= 10000; d *= 10) for (const m of level) if (inRange(m * d)) t.push(Math.round(m * d));
    if (t.length > maxCount) break;
    best = t;
  }
  if (best.length >= 3) return best;
  // 很窄的范围：在对数刻度上均分，保留 2 位有效数字
  const n = Math.min(maxCount, 5), out = [];
  for (let i = 0; i < n; i++) {
    const f = pitch.min * Math.pow(pitch.max / pitch.min, i / (n - 1));
    const p = Math.pow(10, Math.floor(Math.log10(f)) - 1);
    out.push(Math.round(f / p) * p);
  }
  return [...new Set(out)];
}

/** 兼容旧模块：频段索引 0..1 → 颜色 */
export const bandColor = pitchColor;
export const bandCss = pitchCss;

export function makeSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.5)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** 文字精灵（坐标轴标签） */
export function textSprite(text, color = "#9fb0e0", px = 40, spacing = 0) {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  const font = `500 ${px}px system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif`;
  g.font = font;
  if (spacing) g.letterSpacing = `${spacing}px`;
  c.width = Math.ceil(g.measureText(text).width) + 16;
  c.height = Math.round(px * 1.4);
  g.font = font;
  if (spacing) g.letterSpacing = `${spacing}px`;
  g.fillStyle = color;
  g.textBaseline = "middle";
  g.fillText(text, 8, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(c.width / 110, c.height / 110, 1);
  return s;
}

/** 柔边圆点着色器材质：每个顶点有独立的颜色与大小（用于表现强弱） */
export function makePointMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { scale: { value: 300 } },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      uniform float scale;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.15, d);
        gl_FragColor = vec4(vColor, a);
      }`,
  });
}

// ---------------------------------------------------------------------------
// 多尺度分析模块专用色带
//   振幅 PLASMA：深紫 → 紫 → 洋红 → 珊瑚 → 橙 → 黄（与参考图右上角色条一致）
//   音调性 TONAL：深绿 → 绿 → 青绿（参考图左侧散点）
export const PLASMA_STOPS = ["#0d0887", "#6a00a8", "#b12a90", "#e16462", "#fca636", "#f0f921"];
export const TONAL_STOPS = ["#14532d", "#22c55e", "#5eead4", "#ccfbf1"];
const PLASMA_RGB = PLASMA_STOPS.map(hexToRgb), TONAL_RGB = TONAL_STOPS.map(hexToRgb);
export const plasmaRgb = (x) => sample(PLASMA_RGB, x);
export const tonalRgb = (x) => sample(TONAL_RGB, x);
export const plasmaCss = (x) => css(plasmaRgb(x));
export const tonalCss = (x) => css(tonalRgb(x));
export const plasmaGradient = (dir = "to right") => `linear-gradient(${dir}, ${PLASMA_STOPS.join(",")})`;
export const tonalGradient = (dir = "to right") => `linear-gradient(${dir}, ${TONAL_STOPS.join(",")})`;

// ---------------------------------------------------------------------------
// 识别结果分组配色（声音标签 / 鸟种 / 字幕）
export const GROUPS = {
  human:   { name: "人类",     color: "#ffd166" },
  bird:    { name: "鸟类",     color: "#9be15d" },
  animal:  { name: "动物",     color: "#f4a261" },
  insect:  { name: "昆虫",     color: "#e9c46a" },
  plant:   { name: "植物·风声", color: "#52b788" },
  nature:  { name: "水·天气",   color: "#4cc9f0" },
  music:   { name: "音乐",     color: "#c77dff" },
  vehicle: { name: "交通机械", color: "#ff8c69" },
  other:   { name: "其它",     color: "#a0a8c0" },
  species: { name: "鸟种",     color: "#d4ff7a" },
  speech:  { name: "字幕",     color: "#ffffff" },
};
export const GROUP_ORDER = ["human", "bird", "animal", "insect", "plant", "nature", "music", "vehicle", "other"];
export const groupColor = (g) => (GROUPS[g] || GROUPS.other).color;
