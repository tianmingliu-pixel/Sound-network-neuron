// AudioWorklet：在音频线程里截取 PCM，攒够一块后交给主线程。
// 输出为 float32、按声道交错 (L R L R ...)，与后端协议一致。

class PcmTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = options.processorOptions.channels;
    this.blockFrames = options.processorOptions.blockFrames; // 每块帧数，例如 2048 ≈ 43 ms @48k
    this.buf = new Float32Array(this.blockFrames * this.channels);
    this.pos = 0;            // 已写入帧数
    this.enabled = true;
    this.port.onmessage = (e) => {
      if (e.data.type === "enable") { this.enabled = e.data.value; this.pos = 0; }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    // 直通：让声音继续流向扬声器（文件模式需要听见；麦克风模式在外面接 0 增益）
    const out = outputs[0];
    for (let c = 0; c < out.length; c++) {
      if (input[c]) out[c].set(input[c]);
    }
    if (!this.enabled || input.length === 0) return true;

    const n = input[0].length; // 通常 128
    for (let i = 0; i < n; i++) {
      const base = this.pos * this.channels;
      for (let c = 0; c < this.channels; c++) {
        const src = input[c] || input[0]; // 声道不足时复制第一声道
        this.buf[base + c] = src[i];
      }
      this.pos++;
      if (this.pos === this.blockFrames) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Float32Array(this.blockFrames * this.channels);
        this.pos = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-tap", PcmTap);
