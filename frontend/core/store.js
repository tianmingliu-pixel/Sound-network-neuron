// 共享数据仓库：所有面板模块从这里读数据，互不依赖。
// 新模块只需读取 store，并实现 modules/README 中的接口即可接入布局。

const MAX_FRAMES = 60 * 120; // 最多保留 120 秒的帧（60 fps）

export const store = {
  meta: null,          // ready 消息：sr, channels, band_centers
  frames: [],          // 特征帧（按时间递增，最多 120 s）
  trace: [],           // 整段轨迹：按帧序号（t×60）存放的精简帧，跳转不会丢失，用于 3D 整段模型
  traceCount: 0,
  duration: 0,         // 当前文件时长（秒）；直播为 0
  title: "",           // 当前文件名或“直播”
  nodes: [],           // 事件节点（按 id 索引）
  edges: [],           // [src, dst, type]
  pcaReady: false,
  captions: [],        // 语音字幕 {t, t_end, text, lang, lang_name}
  sounds: [],          // 声音分类 {t, t_end, labels:[{zh, en, group, score}]}
  birds: [],           // 鸟种 {t, t_end, species:[{sci, common, conf}]}
  ai: null,            // 识别引擎状态
  time: 0,             // 当前播放/直播时间（秒）
  settings: {
    windowSec: 20,     // 多道记录器与 3D 空间的时间窗
    gain: 1.2,
    coord: "axes",     // 流形坐标：axes | pca
  },

  addFrame(f) {
    const F = this.frames;
    // 时间倒退（跳转回放）→ 截断到该时间之前
    if (F.length && f.t < F[F.length - 1].t - 0.05) {
      let i = F.length - 1;
      while (i >= 0 && F[i].t >= f.t) i--;
      F.length = i + 1;
    }
    F.push(f);
    if (F.length > MAX_FRAMES) F.splice(0, F.length - MAX_FRAMES);
    const idx = Math.round(f.t * 60);
    if (idx >= 0 && idx < 60 * 60 * 60) {   // 最长记录 1 小时
      if (!this.trace[idx]) this.traceCount++;
      this.trace[idx] = { t: f.t, rms: f.rms, centroid: f.centroid, tonality: f.tonality, f0: f.f0 || 0, f0_conf: f.f0_conf || 0 };
    }
  },

  /** 返回 [t0, t1] 时间窗内的帧（二分查找起点） */
  window(t0, t1) {
    const F = this.frames;
    let lo = 0, hi = F.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (F[m].t < t0) lo = m + 1; else hi = m; }
    let end = lo;
    while (end < F.length && F[end].t <= t1) end++;
    return F.slice(lo, end);
  },

  latest() { return this.frames[this.frames.length - 1] ?? null; },

  addNode(node, edges) {
    this.nodes[node.id] = node;
    for (const e of edges) this.edges.push(e);
  },

  applyPca(coords) {
    for (const [id, p] of Object.entries(coords)) if (this.nodes[id]) this.nodes[id].pca = p;
    this.pcaReady = true;
  },

  /** 识别结果按时间插入（跳转回放后可能乱序） */
  addRecog(kind, m) {
    const arr = this[kind];
    // 同一时间段重复识别（跳转后重播）：替换旧结果
    const i = arr.findIndex((x) => Math.abs(x.t - m.t) < 0.3 && (kind !== "captions" || x.text === m.text));
    if (i >= 0) arr[i] = m; else arr.push(m);
    arr.sort((a, b) => a.t - b.t);
    if (arr.length > 2000) arr.splice(0, arr.length - 2000);
  },

  /** 当前时间附近的识别结果（字幕显示用） */
  activeAt(kind, t, hold) {
    const arr = this[kind];
    for (let i = arr.length - 1; i >= 0; i--) {
      const x = arr[i];
      if (x.t <= t + 0.05 && t <= x.t_end + hold) return x;
    }
    return null;
  },

  clearRecog() { this.captions = []; this.sounds = []; this.birds = []; },

  clearFrames() { this.frames = []; this.trace = []; this.traceCount = 0; },
  clearGraph() { this.nodes = []; this.edges = []; this.pcaReady = false; },
};
