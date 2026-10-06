"""
识别引擎 (Recognition Engine) —— v0.4

三类识别，全部在本机运行，任一缺包时自动跳过、不影响其它功能：

  语音字幕  faster-whisper（Whisper，99 种语言，自动识别语种）      pip install faster-whisper
  通用声音  AST 模型，AudioSet 527 类（鸟鸣 / 狗叫 / 雨声 …）        pip install torch transformers
  鸟种      BirdNET（6000+ 鸟种），检测到鸟叫时才调用                 pip install birdnetlib（另需 tensorflow）

数据流（每个 WebSocket 会话一个 AISession）：
  PCM 块 → 单声道 → 16 kHz 环形缓冲
         ├─ 能量 VAD 切句（停顿 ≥ 0.6 s 或满 12 s）→ 语音任务 → caption 消息
         ├─ 每 2 s 取最近 4 s → 声音分类任务 → sound 消息
         │      └─ 若鸟类得分高 → 鸟种任务（原采样率最近 3 s）→ bird 消息
  所有任务进入一个后台线程排队执行，不阻塞实时可视化；排队过长时丢弃旧任务以保持实时。

环境变量：
  NEUROSENSE_WHISPER   模型大小 tiny | base（默认）| small | medium | large-v3
  NEUROSENSE_DEVICE    cpu（默认）| cuda    （AMD 显卡在 Windows 上请用 cpu）
  NEUROSENSE_LAT / NEUROSENSE_LON   录音地点经纬度（可选，BirdNET 用于按地区过滤鸟种）
  NEUROSENSE_AI_FAKE=1 使用假识别器（仅用于开发测试界面，不加载任何模型）
"""
from __future__ import annotations

import os

# hf-xet 的分块下载在部分网络下会中断（"error decoding response body"），改用普通 HTTPS 下载
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import queue
import threading
import time
import traceback
from datetime import date
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent / "models"


def local_model(name: str, required: str) -> str | None:
    """download_models.py 下载到 backend/models/<name> 的模型；不完整时返回 None（改为在线下载）"""
    d = MODELS_DIR / name
    return str(d) if (d / required).exists() and (d / "config.json").exists() else None

import numpy as np

from labels_zh import BIRD_LABELS, GROUP_ORDER, SPEECH_LABELS, audioset_label, lang_name

SR16 = 16000


# ----------------------------------------------------------------------------
# 工具：单声道与重采样
# ----------------------------------------------------------------------------
def _lowpass_taps(cutoff: float, taps: int = 63) -> np.ndarray:
    n = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * cutoff * n) * np.hamming(taps)
    return (h / h.sum()).astype(np.float32)


class Resampler:
    """流式重采样到 16 kHz。整数倍降采样用 FIR 低通 + 抽取，其它比例用线性插值。"""

    def __init__(self, sr_in: int, sr_out: int = SR16):
        self.sr_in, self.sr_out = sr_in, sr_out
        self.q = sr_in // sr_out if sr_in % sr_out == 0 else 0
        if self.q > 1:
            self.h = _lowpass_taps(0.45 / self.q)
            self.tail = np.zeros(len(self.h) - 1, np.float32)
            self.phase = 0

    def __call__(self, x: np.ndarray) -> np.ndarray:
        if self.sr_in == self.sr_out:
            return x.astype(np.float32)
        if self.q > 1:
            y = np.convolve(np.concatenate([self.tail, x]), self.h, mode="valid")
            self.tail = np.concatenate([self.tail, x])[-(len(self.h) - 1):]
            out = y[self.phase::self.q]
            self.phase = (self.phase - len(y)) % self.q
            return out.astype(np.float32)
        n_out = int(round(len(x) * self.sr_out / self.sr_in))
        if n_out <= 0:
            return np.zeros(0, np.float32)
        return np.interp(np.linspace(0, len(x) - 1, n_out), np.arange(len(x)), x).astype(np.float32)


# ----------------------------------------------------------------------------
# 三个识别器（懒加载；缺包时 status 说明安装方法）
# ----------------------------------------------------------------------------
class SpeechRecognizer:
    name = "语音字幕"

    def __init__(self):
        self.model = None
        self.status = "未加载"
        self.size = os.environ.get("NEUROSENSE_WHISPER", "base")
        self.device = os.environ.get("NEUROSENSE_DEVICE", "cpu")

    def load(self):
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            self.status = "未安装：pip install faster-whisper"
            return
        self.status = f"加载中（Whisper {self.size}）…"
        compute = "int8" if self.device == "cpu" else "float16"
        src = local_model(f"faster-whisper-{self.size}", "model.bin") or self.size
        self.model = WhisperModel(src, device=self.device, compute_type=compute)
        self.status = f"就绪 · Whisper {self.size} · {self.device}"

    def transcribe(self, audio16: np.ndarray) -> list[dict]:
        segments, info = self.model.transcribe(
            audio16, beam_size=1, vad_filter=True, condition_on_previous_text=False)
        out = []
        for s in segments:
            # 过滤 Whisper 在非语音上的“幻觉”输出
            if s.no_speech_prob > 0.6 or s.avg_logprob < -1.0 or not s.text.strip():
                continue
            out.append({"start": s.start, "end": s.end, "text": s.text.strip(),
                        "lang": info.language, "lang_prob": float(info.language_probability)})
        return out


class SoundClassifier:
    name = "声音分类"
    MODEL = "MIT/ast-finetuned-audioset-10-10-0.4593"

    def __init__(self):
        self.model = None
        self.status = "未加载"

    def load(self):
        try:
            import torch  # noqa: F401
            from transformers import ASTForAudioClassification, AutoFeatureExtractor
        except ImportError:
            self.status = "未安装：pip install torch transformers"
            return
        self.status = "加载中（AudioSet AST）…"
        src = (local_model("ast-audioset", "model.safetensors")
               or local_model("ast-audioset", "pytorch_model.bin") or self.MODEL)
        self.fe = AutoFeatureExtractor.from_pretrained(src)
        self.model = ASTForAudioClassification.from_pretrained(src).eval()
        self.labels = [self.model.config.id2label[i] for i in range(len(self.model.config.id2label))]
        self.groups = np.array([GROUP_ORDER.index(audioset_label(l)[1]) for l in self.labels])
        self.status = "就绪 · AudioSet 527 类"

    def classify(self, audio16: np.ndarray):
        """返回 (前 10 个类别 [(英文名, 概率)], 各大类得分 {组: 该组内最大概率})"""
        import torch
        inputs = self.fe(audio16, sampling_rate=SR16, return_tensors="pt")
        with torch.no_grad():
            p = torch.sigmoid(self.model(**inputs).logits[0]).numpy()
        idx = np.argsort(-p)[:10]
        groups = {g: float(p[self.groups == i].max(initial=0.0)) for i, g in enumerate(GROUP_ORDER)}
        return [(self.labels[i], float(p[i])) for i in idx], groups


class BirdClassifier:
    name = "鸟种识别"

    def __init__(self):
        self.analyzer = None
        self.status = "未加载"
        self.lat = os.environ.get("NEUROSENSE_LAT")
        self.lon = os.environ.get("NEUROSENSE_LON")

    def load(self):
        try:
            from birdnetlib.analyzer import Analyzer
        except ImportError:
            self.status = "未安装：pip install birdnetlib tensorflow"
            return
        self.status = "加载中（BirdNET）…"
        self.analyzer = Analyzer()
        self.status = "就绪 · BirdNET"

    def classify(self, audio: np.ndarray, sr: int) -> list[dict]:
        from birdnetlib import RecordingBuffer
        kw = {}
        if self.lat and self.lon:
            kw = {"lat": float(self.lat), "lon": float(self.lon), "date": date.today()}
        rec = RecordingBuffer(self.analyzer, audio, sr, min_conf=0.25, **kw)
        rec.analyze()
        best: dict[str, dict] = {}
        for d in rec.detections:
            k = d["scientific_name"]
            if k not in best or d["confidence"] > best[k]["conf"]:
                best[k] = {"sci": k, "common": d["common_name"], "conf": float(d["confidence"])}
        return sorted(best.values(), key=lambda x: -x["conf"])[:3]


# ----------------------------------------------------------------------------
# 假识别器：只用于开发时测试界面与数据流
# ----------------------------------------------------------------------------
class _FakeSpeech(SpeechRecognizer):
    def load(self): self.model = True; self.n = 0; self.status = "就绪 · 假识别器（测试）"
    def transcribe(self, audio16):
        self.n += 1
        return [{"start": 0.0, "end": len(audio16) / SR16, "text": f"（测试字幕 {self.n}）Hello world",
                 "lang": ["en", "ja", "zh", "fr"][self.n % 4], "lang_prob": 0.9}]


class _FakeSound(SoundClassifier):
    def load(self): self.model = True; self.status = "就绪 · 假识别器（测试）"
    def classify(self, audio16):
        spec = np.abs(np.fft.rfft(audio16[-8192:]))
        f = np.fft.rfftfreq(min(len(audio16), 8192), 1 / SR16)
        c = float((f * spec).sum() / (spec.sum() + 1e-9))
        g = {k: 0.02 for k in GROUP_ORDER}
        if c > 1500:
            g.update(bird=0.82, insect=0.18, plant=0.1, human=0.2)
            return [("Bird vocalization, bird call, bird song", 0.82), ("Bird", 0.7), ("Speech", 0.2)], g
        g.update(music=0.75, human=0.3, nature=0.08)
        return [("Music", 0.75), ("Drum", 0.5), ("Speech", 0.3)], g


class _FakeBird(BirdClassifier):
    def load(self): self.analyzer = True; self.status = "就绪 · 假识别器（测试）"
    def classify(self, audio, sr):
        return [{"sci": "Erithacus rubecula", "common": "European Robin", "conf": 0.81}]


# ----------------------------------------------------------------------------
# 引擎：一个后台线程 + 任务队列，所有会话共享模型
# ----------------------------------------------------------------------------
class AIEngine:
    def __init__(self):
        fake = os.environ.get("NEUROSENSE_AI_FAKE") == "1"
        self.speech = (_FakeSpeech if fake else SpeechRecognizer)()
        self.sound = (_FakeSound if fake else SoundClassifier)()
        self.bird = (_FakeBird if fake else BirdClassifier)()
        self.jobs: queue.Queue = queue.Queue(maxsize=12)
        self.listeners: set = set()
        self.started = False

    def start(self):
        if self.started:
            return
        self.started = True
        threading.Thread(target=self._run, daemon=True, name="neurosense-ai").start()

    def status(self) -> dict:
        return {"type": "ai_status", "speech": self.speech.status,
                "sound": self.sound.status, "bird": self.bird.status}

    def _broadcast_status(self):
        st = self.status()
        for emit in list(self.listeners):
            emit(st)

    def submit(self, job: tuple) -> None:
        try:
            self.jobs.put_nowait(job)
        except queue.Full:  # 跟不上实时：丢掉最旧的任务
            try:
                self.jobs.get_nowait()
            except queue.Empty:
                pass
            self.jobs.put_nowait(job)

    def _run(self):
        for r in (self.sound, self.speech, self.bird):
            try:
                r.status = "加载中…"
                self._broadcast_status()
                r.load()
            except Exception as e:  # 模型下载失败等
                r.status = "加载失败：模型下载中断，请运行 python download_models.py"
                traceback.print_exc()
                print("\n>>> 模型下载失败。请在 backend 目录运行：python download_models.py  （然后重启 server.py）\n")
            self._broadcast_status()
        while True:
            kind, session, payload = self.jobs.get()
            if session.closed:
                continue
            try:
                if kind == "speech" and self.speech.model:
                    session.on_speech(self.speech.transcribe(payload["audio"]), payload)
                elif kind == "sound" and self.sound.model:
                    session.on_sound(self.sound.classify(payload["audio"]), payload)
                elif kind == "bird" and self.bird.analyzer:
                    session.on_bird(self.bird.classify(payload["audio"], payload["sr"]), payload)
            except Exception as e:
                traceback.print_exc()
                session.emit({"type": "error", "message": f"{kind} 识别出错：{e}"})


ENGINE = AIEngine()


# ----------------------------------------------------------------------------
# 会话：缓冲、切句、调度
# ----------------------------------------------------------------------------
class AISession:
    RING_SEC = 30
    FRAME = 480            # 30 ms @ 16 kHz
    SOUND_EVERY = 2.0      # 每 2 s 做一次声音分类
    SOUND_WIN = 4.0        # 取最近 4 s
    BIRD_WIN = 3.0         # BirdNET 固定 3 s 片段
    SILENCE_END = 0.6      # 停顿 ≥ 0.6 s 结束一句
    MAX_UTT = 12.0         # 一句最长 12 s

    def __init__(self, sr: int, channels: int, emit, engine: AIEngine = ENGINE):
        self.sr, self.ch, self.emit, self.engine = sr, channels, emit, engine
        self.closed = False
        engine.listeners.add(emit)
        self.reset(0.0)

    def close(self):
        self.closed = True
        self.engine.listeners.discard(self.emit)

    def reset(self, t0: float):
        self.t0 = t0
        self.rs = Resampler(self.sr)
        self.a16 = np.zeros(0, np.float32)     # 16 kHz 环形缓冲
        self.raw = np.zeros(0, np.float32)     # 原采样率（给 BirdNET）
        self.n16 = 0                           # 已接收 16 kHz 样本总数
        self.pending = np.zeros(0, np.float32) # 尚未进入 VAD 的样本
        self.noise = 0.003
        self.active = False
        self.utt_start = 0                     # 句子起点（n16 计数）
        self.silence = 0.0
        self.next_sound = self.SOUND_EVERY
        self.last_bird = -1e9
        self.recent_sound: list[tuple[float, float, float, float]] = []  # (t0, t1, speech, bird)

    # 时间换算：16 kHz 样本计数 → 媒体时间
    def _t(self, n: int) -> float:
        return self.t0 + n / SR16

    def _slice(self, n_from: int, n_to: int) -> np.ndarray:
        start = self.n16 - len(self.a16)
        return self.a16[max(0, n_from - start): max(0, n_to - start)].copy()

    def push(self, pcm: np.ndarray):
        mono = pcm.mean(axis=1).astype(np.float32) if pcm.ndim == 2 else pcm.astype(np.float32)
        self.raw = np.concatenate([self.raw, mono])[-int(self.sr * 6):]
        y = self.rs(mono)
        self.a16 = np.concatenate([self.a16, y])[-SR16 * self.RING_SEC:]
        self.n16 += len(y)
        self.pending = np.concatenate([self.pending, y])
        self._vad()
        # 定时声音分类
        now = self.n16 / SR16
        if now >= self.next_sound and self.engine.sound.model:
            self.next_sound = now + self.SOUND_EVERY
            n0 = max(0, self.n16 - int(self.SOUND_WIN * SR16))
            self.engine.submit(("sound", self, {"audio": self._slice(n0, self.n16),
                                                "t0": self._t(n0), "t1": self._t(self.n16),
                                                "raw": self.raw[-int(self.sr * self.BIRD_WIN):].copy()}))

    def _vad(self):
        F = self.FRAME
        base = self.n16 - len(self.pending)
        i = 0
        while i + F <= len(self.pending):
            e = float(np.sqrt(np.mean(self.pending[i:i + F] ** 2)))
            pos = base + i + F
            th = max(self.noise * 3.0, 0.008)
            if e > th:
                if not self.active:
                    self.active = True
                    self.utt_start = max(0, pos - int(0.3 * SR16))  # 预留 0.3 s 前导
                self.silence = 0.0
            else:
                self.noise = 0.97 * self.noise + 0.03 * e
                if self.active:
                    self.silence += F / SR16
                    if self.silence >= self.SILENCE_END:
                        self._close_utt(pos - int((self.silence - 0.2) * SR16))
            if self.active and (pos - self.utt_start) / SR16 >= self.MAX_UTT:
                self._close_utt(pos, keep_active=True)
            i += F
        self.pending = self.pending[i:]

    def _close_utt(self, end: int, keep_active: bool = False):
        start = self.utt_start
        self.active = keep_active
        self.silence = 0.0
        if keep_active:
            self.utt_start = end
        if (end - start) / SR16 < 0.4 or not self.engine.speech.model:
            return
        t0, t1 = self._t(start), self._t(end)
        # 若已有声音分类结果，且这段时间里“说话”的可能性很低，就不送去 Whisper（省 CPU，也减少幻觉）
        overlap = [s for (a, b, s, _) in self.recent_sound if b > t0 and a < t1]
        if overlap and max(overlap) < 0.12:
            return
        self.engine.submit(("speech", self, {"audio": self._slice(start, end), "t0": t0, "t1": t1}))

    # ---- 识别结果回调（在后台线程中调用） ----
    def on_speech(self, segs: list[dict], job: dict):
        for s in segs:
            self.emit({"type": "caption", "t": round(job["t0"] + s["start"], 2),
                       "t_end": round(job["t0"] + s["end"], 2), "text": s["text"],
                       "lang": s["lang"], "lang_name": lang_name(s["lang"]),
                       "lang_prob": round(s["lang_prob"], 2)})

    def on_sound(self, result, job: dict):
        top, groups = result
        speech = max([p for (l, p) in top if l in SPEECH_LABELS] or [0.0])
        bird = max([p for (l, p) in top if l in BIRD_LABELS] or [0.0])
        self.recent_sound = (self.recent_sound + [(job["t0"], job["t1"], speech, bird)])[-20:]
        labels = []
        for en, p in top:
            if p < 0.12:
                continue
            zh, group = audioset_label(en)
            labels.append({"en": en, "zh": zh, "group": group, "score": round(p, 2)})
        self.emit({"type": "sound", "t": round(job["t0"], 2), "t_end": round(job["t1"], 2),
                   "labels": labels[:5], "groups": {k: round(v, 3) for k, v in groups.items()}})
        if bird >= 0.15 and job["t1"] - self.last_bird >= self.BIRD_WIN and self.engine.bird.analyzer:
            self.last_bird = job["t1"]
            self.engine.submit(("bird", self, {"audio": job["raw"], "sr": self.sr,
                                               "t0": max(self.t0, job["t1"] - self.BIRD_WIN), "t1": job["t1"]}))

    def on_bird(self, species: list[dict], job: dict):
        if species:
            self.emit({"type": "bird", "t": round(job["t0"], 2), "t_end": round(job["t1"], 2),
                       "species": [{**s, "conf": round(s["conf"], 2)} for s in species]})
