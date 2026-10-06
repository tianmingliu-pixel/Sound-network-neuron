"""
音频分析引擎 (Audio Analysis Engine)

职责：把一段音频变成逐帧的“声学特征帧”，供前端做 3D 可视化。
每一帧包含：
  - bands    : 对数间隔的频段能量 (0~1)，低频 → 高频
  - rms      : 整体响度 (0~1)
  - centroid : 频谱质心 (Hz)，反映“明亮度”
  - azimuth  : 声源水平方位角 (度, -90 左 ~ +90 右)
  - elevation, distance : 预留给后续 SELD 模型（当前为固定值）

设计说明：
  - 定位 (Localizer) 被做成可替换的接口。当前实现是基于双声道
    声级差 (ILD) 的“声像方位”估计 —— 适用于立体声文件，
    并非真实的三维声源定位。之后接入麦克风阵列 + SELD 模型时，
    只需替换 Localizer 即可，前端不用改。
"""
from __future__ import annotations

import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np


# ----------------------------------------------------------------------------
# 读取 WAV（仅用标准库 + numpy，避免额外依赖）
# ----------------------------------------------------------------------------
def load_wav(path: str | Path) -> tuple[int, np.ndarray]:
    """返回 (采样率, 数据)；数据形状为 (样本数, 声道数)，float32，范围 [-1, 1]。"""
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        sw = wf.getsampwidth()
        raw = wf.readframes(wf.getnframes())

    if sw == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128.0
    elif sw == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif sw == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        i32 = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8)
               | (b[:, 2].astype(np.int32) << 16))
        i32 = np.where(i32 & 0x800000, i32 - 0x1000000, i32)
        data = i32.astype(np.float32) / 8388608.0
    elif sw == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"不支持的采样位宽: {sw * 8} bit")

    return sr, data.reshape(-1, ch)


def save_wav(path: str | Path, sr: int, data: np.ndarray) -> None:
    """保存 float 数据为 16-bit WAV。data 形状 (样本数, 声道数)。"""
    data = np.clip(data, -1, 1)
    pcm = (data * 32767).astype("<i2")
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(data.shape[1])
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


# ----------------------------------------------------------------------------
# 定位器接口
# ----------------------------------------------------------------------------
class Localizer:
    """声源定位接口。输入一个多声道时域块，输出 (azimuth°, elevation°, distance m)。"""

    def locate(self, block: np.ndarray) -> tuple[float, float, float]:
        raise NotImplementedError


class StereoILDLocalizer(Localizer):
    """基于左右声道能量差 (ILD) 的声像方位估计。单声道时返回正前方。"""

    def locate(self, block: np.ndarray) -> tuple[float, float, float]:
        if block.shape[1] < 2:
            return 0.0, 0.0, 2.0
        el = float(np.sum(block[:, 0] ** 2))
        er = float(np.sum(block[:, 1] ** 2))
        pan = (er - el) / (er + el + 1e-12)  # -1 左 ~ +1 右
        return pan * 90.0, 0.0, 2.0


# ----------------------------------------------------------------------------
# 基频（音高）检测：YIN 算法（de Cheveigné & Kawahara, 2002）
# ----------------------------------------------------------------------------
def yin_f0(x: np.ndarray, sr: int, fmin: float = 50.0, fmax: float = 4000.0,
           threshold: float = 0.15) -> tuple[float, float]:
    """返回 (基频 Hz, 可信度 0..1)。无明确音高（噪声、静音）时基频为 0。

    复音音乐里返回的是最突出的那个音高；可信度低时说明没有清晰的单一音高。
    """
    x = x.astype(np.float64) - float(np.mean(x))
    n = len(x)
    w = n // 2                                   # 积分窗口
    tau_max = min(int(sr / fmin), w - 1)
    tau_min = max(2, int(sr / fmax))
    if tau_max <= tau_min + 2 or np.dot(x, x) < 1e-8:
        return 0.0, 0.0
    # d(τ) = Σ (x_j - x_{j+τ})²  =  e0 + e_τ - 2 r_τ，用 FFT 计算互相关
    size = 1 << int(np.ceil(np.log2(n + w)))
    r = np.fft.irfft(np.fft.rfft(x, size) * np.conj(np.fft.rfft(x[:w], size)), size)[: tau_max + 1]
    cum = np.concatenate([[0.0], np.cumsum(x * x)])
    e0 = cum[w]
    taus = np.arange(tau_max + 1)
    e_tau = cum[taus + w] - cum[taus]
    d = e0 + e_tau - 2 * r
    d[0] = 0.0
    # 累积均值归一化差分函数 d'(τ)
    cmnd = np.ones_like(d)
    running = np.cumsum(d[1:])
    cmnd[1:] = d[1:] * np.arange(1, tau_max + 1) / np.maximum(running, 1e-12)
    seg = cmnd[tau_min: tau_max + 1]
    below = np.nonzero(seg < threshold)[0]
    if len(below):
        i = below[0]
        while i + 1 < len(seg) and seg[i + 1] < seg[i]:   # 走到这个谷的最低点
            i += 1
    else:
        i = int(np.argmin(seg))
    tau = i + tau_min
    conf = float(np.clip(1.0 - cmnd[tau], 0.0, 1.0))
    # 抛物线插值，得到亚样本精度
    if 1 <= tau < tau_max:
        a, b, c = cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]
        den = a - 2 * b + c
        if abs(den) > 1e-12:
            tau = tau + 0.5 * (a - c) / den
    if not len(below) and conf < 0.5:
        return 0.0, conf
    return float(sr / tau), conf


# ----------------------------------------------------------------------------
# 频谱分析
# ----------------------------------------------------------------------------
@dataclass
class AnalyzerConfig:
    n_fft: int = 2048
    n_bands: int = 64
    fmin: float = 30.0
    fmax: float = 16000.0
    fps: int = 60
    db_floor: float = -80.0


class SpectralAnalyzer:
    def __init__(self, sr: int, cfg: AnalyzerConfig | None = None,
                 localizer: Localizer | None = None):
        self.sr = sr
        self.cfg = cfg or AnalyzerConfig()
        self.localizer = localizer or StereoILDLocalizer()
        c = self.cfg

        self.window = np.hanning(c.n_fft).astype(np.float32)
        self.freqs = np.fft.rfftfreq(c.n_fft, 1.0 / sr)
        fmax = min(c.fmax, sr / 2 * 0.95)
        edges = np.geomspace(c.fmin, fmax, c.n_bands + 1)
        # 每个 FFT bin 属于哪个频段（-1 表示不在范围内）
        self.bin_band = np.digitize(self.freqs, edges) - 1
        self.bin_band[(self.freqs < edges[0]) | (self.freqs >= edges[-1])] = -1
        self.band_centers = np.sqrt(edges[:-1] * edges[1:])
        # 保证每个频段至少有一个 bin（低频段可能太窄）
        self._fallback_bin = np.array(
            [int(np.argmin(np.abs(self.freqs - fc))) for fc in self.band_centers])
        # 色度图：把 55 Hz ~ 5 kHz 的 bin 折叠到 12 个音级（C=0, C#=1, ... B=11）
        midi = 69 + 12 * np.log2(np.maximum(self.freqs, 1.0) / 440.0)
        self.chroma_bin = np.where((self.freqs >= 55) & (self.freqs <= 5000),
                                   np.round(midi).astype(int) % 12, -1)

    def analyze_block(self, block: np.ndarray) -> dict:
        """分析一个 (n_fft, 声道) 的时域块，返回未归一化的原始特征。"""
        c = self.cfg
        mono = block.mean(axis=1) * self.window
        spec = np.abs(np.fft.rfft(mono)) ** 2

        band_pow = np.bincount(self.bin_band[self.bin_band >= 0],
                               weights=spec[self.bin_band >= 0],
                               minlength=c.n_bands)[: c.n_bands]
        empty = band_pow == 0
        band_pow[empty] = spec[self._fallback_bin[empty]]
        band_db = 10 * np.log10(band_pow + 1e-12)

        total = spec.sum() + 1e-12
        centroid = float((self.freqs * spec).sum() / total)
        # 谱平坦度：几何均值 / 算术均值。纯音 ≈ 0，白噪声 ≈ 0.5~0.6
        inband = spec[self.bin_band >= 0] + 1e-12
        flatness = float(np.exp(np.mean(np.log(inband))) / np.mean(inband))
        sel = self.chroma_bin >= 0
        chroma = np.bincount(self.chroma_bin[sel], weights=spec[sel], minlength=12)
        chroma = chroma / (chroma.max() + 1e-12)
        rms = float(np.sqrt(np.mean(block ** 2)))
        f0, f0c = yin_f0(block.mean(axis=1), self.sr) if rms > 1e-4 else (0.0, 0.0)
        az, el, dist = self.localizer.locate(block)
        return dict(band_db=band_db, rms=rms, centroid=centroid, flatness=flatness, chroma=chroma,
                    f0=f0, f0_conf=f0c,
                    azimuth=az, elevation=el, distance=dist)


def analyze_file(path: str | Path, cfg: AnalyzerConfig | None = None) -> dict:
    """离线分析整个 WAV 文件，返回按时间索引的特征帧（已归一化到 0~1）。

    v0.2 起实时界面走 stream_engine.StreamSession；本函数保留给离线批处理 / 科研脚本使用。
    """
    cfg = cfg or AnalyzerConfig()
    sr, data = load_wav(path)
    an = SpectralAnalyzer(sr, cfg)
    hop = sr / cfg.fps
    n_frames = max(1, int(len(data) / hop))
    pad = np.zeros((cfg.n_fft, data.shape[1]), dtype=np.float32)
    padded = np.concatenate([pad, data, pad])

    raw = []
    for i in range(n_frames):
        center = int(i * hop) + cfg.n_fft  # 补零后的中心位置
        block = padded[center - cfg.n_fft // 2: center + cfg.n_fft // 2]
        raw.append(an.analyze_block(block))

    # 以整首曲目的 99 分位作为 0 dB 参考，做全局归一化
    all_db = np.stack([r["band_db"] for r in raw])
    ref = np.percentile(all_db, 99)
    bands = np.clip((all_db - ref - cfg.db_floor) / -cfg.db_floor, 0, 1)
    rms = np.array([r["rms"] for r in raw])
    rms_n = np.clip(rms / (np.percentile(rms, 99) + 1e-9), 0, 1)

    frames = []
    for i, r in enumerate(raw):
        frames.append({
            "t": round(i / cfg.fps, 4),
            "bands": np.round(bands[i], 3).tolist(),
            "rms": round(float(rms_n[i]), 3),
            "centroid": round(r["centroid"], 1),
            "azimuth": round(r["azimuth"], 2),
            "elevation": r["elevation"],
            "distance": r["distance"],
        })
    return {
        "sr": sr,
        "channels": int(data.shape[1]),
        "duration": len(data) / sr,
        "fps": cfg.fps,
        "band_centers": np.round(an.band_centers, 1).tolist(),
        "frames": frames,
    }


# ----------------------------------------------------------------------------
# 合成演示音频：让项目开箱即可运行
# ----------------------------------------------------------------------------
def make_demo_wav(path: str | Path, sr: int = 44100, seconds: float = 16.0) -> None:
    """生成一段立体声演示音：扫频 + 鼓点 + 和弦，声像从左移到右再回来。"""
    t = np.arange(int(sr * seconds)) / sr
    rng = np.random.default_rng(7)

    # 1) 对数扫频 80Hz → 6kHz，周期 8 秒
    phase_t = (t % 8.0)
    f0, f1, T = 80.0, 6000.0, 8.0
    k = np.log(f1 / f0) / T
    sweep = 0.25 * np.sin(2 * np.pi * f0 * (np.exp(k * phase_t) - 1) / k)

    # 2) 低音鼓点：每 0.5 秒一下，60Hz 衰减正弦
    kick = np.zeros_like(t)
    for start in np.arange(0, seconds, 0.5):
        idx = (t >= start) & (t < start + 0.35)
        tt = t[idx] - start
        kick[idx] += 0.8 * np.sin(2 * np.pi * (60 + 90 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 9)

    # 3) 镲片：每 0.25 秒一下，高通噪声
    hat = np.zeros_like(t)
    for start in np.arange(0.125, seconds, 0.25):
        idx = (t >= start) & (t < start + 0.06)
        n = rng.standard_normal(idx.sum())
        n = np.diff(n, prepend=0)  # 简易高通
        hat[idx] += 0.12 * n * np.exp(-(t[idx] - start) * 60)

    # 4) 和弦 pad：A 小调，每 4 秒换一次
    chords = [[220, 261.6, 329.6], [174.6, 220, 261.6],
              [196, 246.9, 293.7], [164.8, 207.7, 246.9]]
    pad = np.zeros_like(t)
    for ci, start in enumerate(np.arange(0, seconds, 4.0)):
        idx = (t >= start) & (t < start + 4.0)
        tt = t[idx] - start
        env = np.minimum(1, tt / 0.5) * np.minimum(1, (4.0 - tt) / 0.5)
        for f in chords[ci % 4]:
            pad[idx] += 0.07 * env * np.sin(2 * np.pi * f * tt)

    # 声像：扫频绕圈移动，其它元素居中
    pan = np.sin(2 * np.pi * t / 8.0)  # -1 ~ 1
    gl, gr = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    center = kick + hat + pad
    left = center * 0.7 + sweep * gl * 1.4
    right = center * 0.7 + sweep * gr * 1.4
    stereo = np.stack([left, right], axis=1)
    stereo /= np.max(np.abs(stereo)) * 1.05
    save_wav(path, sr, stereo.astype(np.float32))
