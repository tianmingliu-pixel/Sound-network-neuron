// 输入管理：文件（音频 / 视频）与直播（麦克风 + 可选摄像头）统一成 PCM 流。
//
//   <video> 文件 ──► MediaElementSource ─┐
//                                         ├─► AudioWorklet(pcm-tap) ─► monitor(增益) ─► 扬声器
//   麦克风 ─────────► MediaStreamSource ──┘          │
//                                                     └─► onPcm(Float32Array 交错)  → WebSocket
//
// 浏览器负责解码所有格式，并统一重采样到 AudioContext 的采样率（48 kHz）。

const SAMPLE_RATE = 48000;
const BLOCK_FRAMES = 2048; // ≈ 43 ms

export class InputManager {
  constructor({ video, onPcm, onStart, onStop, onError }) {
    this.video = video;
    this.onPcm = onPcm;       // (ArrayBuffer) => void
    this.onStart = onStart;   // ({sr, channels, t0, source}) => void
    this.onStop = onStop;     // () => void
    this.onError = onError;   // (message) => void
    this.ctx = null;
    this.mode = null;         // "file" | "live"
    this.tap = null;
    this.elementSource = null;
    this.liveStream = null;
    this.liveSource = null;
    this.liveT0 = 0;
    this.channels = 2;
    this._bindVideoEvents();
  }

  /** 必须在用户点击中调用：浏览器要求音频上下文由用户手势启动 */
  async resume() { await this._ensureContext(); }

  get sampleRate() { return this.ctx?.sampleRate ?? SAMPLE_RATE; }

  async _ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
    await this.ctx.audioWorklet.addModule("worklet.js");
    this.monitor = this.ctx.createGain();
    this.monitor.connect(this.ctx.destination);
  }

  _makeTap(channels) {
    if (this.tap) { this.tap.disconnect(); this.tap.port.onmessage = null; }
    this.channels = channels;
    this.tap = new AudioWorkletNode(this.ctx, "pcm-tap", {
      numberOfInputs: 1, numberOfOutputs: 1,
      outputChannelCount: [channels],
      channelCount: channels, channelCountMode: "explicit", channelInterpretation: "discrete",
      processorOptions: { channels, blockFrames: BLOCK_FRAMES },
    });
    this.tap.port.onmessage = (e) => this.onPcm(e.data);
    this.tap.connect(this.monitor);
    this._enable(false);
  }

  _enable(v) { this.tap?.port.postMessage({ type: "enable", value: v }); }

  // -------------------------------------------------------------------------
  // 文件模式
  // -------------------------------------------------------------------------
  async useFile(url, name) {
    await this._ensureContext();
    this.stopLive();
    this.mode = "file";
    this.fileName = name;
    const v = this.video;
    v.srcObject = null;
    v.muted = false;
    v.src = url;
    v.load();
    if (!this.elementSource) this.elementSource = this.ctx.createMediaElementSource(v);
    this.elementSource.disconnect();
    this._makeTap(2);
    this.elementSource.connect(this.tap);
    this.monitor.gain.value = 1; // 文件模式：能听到声音
  }

  _bindVideoEvents() {
    const v = this.video;
    const begin = () => {
      if (this.mode !== "file") return;
      this.onStart({ sr: this.sampleRate, channels: this.channels, t0: v.currentTime, source: "file" });
      this._enable(true);
    };
    const halt = () => { if (this.mode === "file") { this._enable(false); this.onStop(); } };
    v.addEventListener("playing", begin);
    for (const ev of ["pause", "seeking", "waiting", "ended"]) v.addEventListener(ev, halt);
    v.addEventListener("error", () => {
      if (this.mode !== "file" || !v.error) return;
      // 解码失败：交给主程序请求后端自动转码（onDecodeError），没有处理函数时只提示
      if (v.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || v.error.code === MediaError.MEDIA_ERR_DECODE) {
        if (this.onDecodeError) this.onDecodeError(this.fileName);
        else this.onError(`浏览器无法解码「${this.fileName}」`);
      } else {
        this.onError(`媒体加载失败（错误码 ${v.error.code}）`);
      }
    });
    v.addEventListener("loadedmetadata", () => {
      // 视频容器但画面解码失败（如 HEVC / ProRes）：有声音没画面
      if (this.mode === "file" && /\.(mp4|m4v|webm|mov|mkv)$/i.test(this.fileName || "") && v.videoWidth === 0) {
        this.onError("音轨可用，但视频画面无法解码（可能是 HEVC / ProRes）。分析不受影响；需要画面的话，在文件列表旁点「转码」生成 H.264 版本。");
      }
    });
  }

  // -------------------------------------------------------------------------
  // 直播模式
  // -------------------------------------------------------------------------
  async startLive({ camera }) {
    await this._ensureContext();
    this.video.pause();
    this.stopLive();
    this.mode = "live";
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // 关闭通话类处理：科研分析需要原始信号
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
          channelCount: { ideal: 2 },
        },
        video: camera ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      });
    } catch (e) {
      this.mode = null;
      this.onError(`无法打开麦克风/摄像头：${e.message}`);
      return false;
    }
    this.liveStream = stream;
    const track = stream.getAudioTracks()[0];
    const ch = Math.max(1, Math.min(track.getSettings().channelCount || 1, 8));

    // 摄像头画面：只给 <video> 视频轨，避免麦克风声音从扬声器回放造成啸叫
    const v = this.video;
    v.removeAttribute("src");
    v.srcObject = stream.getVideoTracks().length ? new MediaStream(stream.getVideoTracks()) : null;
    v.muted = true;
    if (v.srcObject) v.play().catch(() => {});

    if (this.elementSource) this.elementSource.disconnect();
    this.liveSource = this.ctx.createMediaStreamSource(stream);
    this._makeTap(ch);
    this.liveSource.connect(this.tap);
    this.monitor.gain.value = 0; // 直播模式：不回放
    this.liveT0 = performance.now() / 1000;
    this.onStart({ sr: this.sampleRate, channels: ch, t0: 0, source: "mic" });
    this._enable(true);
    return { channels: ch, label: track.label };
  }

  liveTime() { return performance.now() / 1000 - this.liveT0; }

  stopLive() {
    if (this.liveStream) {
      this.liveStream.getTracks().forEach((t) => t.stop());
      this.liveStream = null;
    }
    if (this.liveSource) { this.liveSource.disconnect(); this.liveSource = null; }
    if (this.mode === "live") {
      this._enable(false);
      this.video.srcObject = null;
      this.mode = null;
      this.onStop();
    }
  }

  /** 当前时间轴位置（秒）：文件 = 播放位置，直播 = 开播以来 */
  now() {
    if (this.mode === "file") return this.video.currentTime;
    if (this.mode === "live") return this.liveTime();
    return 0;
  }
}
