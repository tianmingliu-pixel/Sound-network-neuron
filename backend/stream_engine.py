"""
流式分析引擎 (Streaming Engine) —— v0.2

文件、视频、麦克风三种输入在浏览器里统一解码成 float32 PCM，分块推送到这里。
本模块对后端来说只有一种输入：PCM 块。

一个 StreamSession 对应一个 WebSocket 连接，负责：
  1. 逐帧频谱特征（与 v0.1 相同），改为滑动窗口实时归一化
  2. 起始点检测 (onset detection) → 切分出“声音事件”（音节 / 音符 / 鼓点）
  3. 增量建图：每个事件是一个节点
        - 时序边：上一个事件 → 当前事件
        - 相似边：与历史上频谱形状最相似的 k 个事件
  4. 节点坐标（两套，前端可切换）
        - axes：固定特征轴  x=频谱质心(对数)  y=峰值响度  z=音调性   → 稳定、可解释
        - pca ：前 N 个事件学出 PCA 投影后冻结                       → 数据驱动
  5. 导出为 GNN 可直接使用的图（节点特征矩阵 x + edge_index）
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import numpy as np

from audio_engine import AnalyzerConfig, SpectralAnalyzer

SPACE = 4.0  # 流形坐标范围 [-SPACE, SPACE]


@dataclass
class StreamConfig:
    analyzer: AnalyzerConfig = field(default_factory=AnalyzerConfig)
    db_range: float = 60.0           # 归一化动态范围 (dB)
    ref_decay_db: float = 0.05       # 参考电平每帧衰减（≈3 dB/s）
    ref_floor_db: float = 0.0        # 参考电平下限：避免把安静底噪放大
    rms_floor: float = 0.01
    onset_delta: float = 1.2         # 通量超过局部中值的量（以频段数归一化前）
    onset_min_gap: float = 0.08      # 两次起始点最小间隔 (s)
    onset_gate: float = 0.12         # 响度门限（归一化 rms）
    event_max_dur: float = 0.6       # 单个事件最长时长 (s)
    event_release: float = 0.3       # 响度降到峰值的该比例以下即认为事件结束
    temporal_gap: float = 2.0        # 超过该间隔不连时序边 (s)
    sim_k: int = 2
    sim_threshold: float = 0.80      # 余弦相似度阈值（形状向量）
    pca_after: int = 24              # 收集多少个事件后学习并冻结 PCA
    max_nodes: int = 3000


class StreamSession:
    def __init__(self, sr: int, channels: int, cfg: StreamConfig | None = None):
        self.cfg = cfg or StreamConfig()
        self.sr = int(sr)
        self.ch = int(channels)
        self.an = SpectralAnalyzer(self.sr, self.cfg.analyzer)
        self.n_fft = self.cfg.analyzer.n_fft
        self.hop = self.sr / self.cfg.analyzer.fps
        self.band_centers = self.an.band_centers
        # 图（跨 reset 保留，便于把一段视频的多个片段累积在同一张图里）
        self.nodes: list[dict] = []
        self.shape_vecs: list[np.ndarray] = []
        self.edges: list[tuple[int, int, int]] = []  # (src, dst, type) type: 0 时序, 1 相似
        self.pca: tuple[np.ndarray, np.ndarray, np.ndarray] | None = None  # (mean, comps, scale)
        self.reset(0.0)

    # ------------------------------------------------------------------
    def reset(self, t0: float) -> None:
        """跳转 / 重新开始：清空信号缓冲，图保留。"""
        self.t0 = float(t0)
        self.buf = np.zeros((0, self.ch), dtype=np.float32)
        self.total = 0                       # 已接收样本数
        self.next_end = float(self.n_fft)    # 下一帧窗口的结束样本
        self.ref_db = self.cfg.ref_floor_db
        self.rms_ref = self.cfg.rms_floor
        self.prev_bands: np.ndarray | None = None
        self.flux_hist: deque[float] = deque(maxlen=30)
        self.last_onset = -1e9
        self.event: dict | None = None
        self.last_node_time: float | None = None

    def clear_graph(self) -> None:
        self.nodes.clear(); self.shape_vecs.clear(); self.edges.clear()
        self.pca = None
        self.last_node_time = None

    # ------------------------------------------------------------------
    def push(self, pcm: np.ndarray) -> list[dict]:
        """输入 (样本数, 声道) 的 float32 块，返回要发送给前端的消息列表。"""
        if pcm.ndim == 1:
            pcm = pcm.reshape(-1, self.ch)
        self.buf = np.concatenate([self.buf, pcm.astype(np.float32, copy=False)])
        self.total += len(pcm)
        out: list[dict] = []
        start_sample = self.total - len(self.buf)
        while self.next_end <= self.total:
            end = int(self.next_end) - start_sample
            block = self.buf[max(0, end - self.n_fft): end]
            if len(block) < self.n_fft:
                block = np.concatenate([np.zeros((self.n_fft - len(block), self.ch), np.float32), block])
            t = self.t0 + (self.next_end - self.n_fft / 2) / self.sr
            out.extend(self._frame(block, t))
            self.next_end += self.hop
        # 只保留下一帧需要的样本
        keep = int(self.total - (self.next_end - self.n_fft)) + 1
        if len(self.buf) > keep:
            self.buf = self.buf[-keep:] if keep > 0 else self.buf[:0]
        return out

    # ------------------------------------------------------------------
    def _frame(self, block: np.ndarray, t: float) -> list[dict]:
        c = self.cfg
        r = self.an.analyze_block(block)

        # 滑动归一化（直播时没有“整首”可用）
        self.ref_db = max(float(r["band_db"].max()), self.ref_db - c.ref_decay_db, c.ref_floor_db)
        bands = np.clip((r["band_db"] - self.ref_db + c.db_range) / c.db_range, 0, 1)
        self.rms_ref = max(r["rms"], self.rms_ref * 0.997, c.rms_floor)
        rms_n = min(1.0, r["rms"] / self.rms_ref)
        tonality = float(np.clip(1 - r["flatness"] / 0.5, 0, 1))

        msgs = [{
            "type": "frame", "t": round(t, 4),
            "bands": np.round(bands, 3).tolist(),
            "rms": round(rms_n, 3), "centroid": round(r["centroid"], 1),
            "tonality": round(tonality, 3),
            "chroma": np.round(r["chroma"], 2).tolist(),
            "f0": round(r["f0"], 1), "f0_conf": round(r["f0_conf"], 2),   # 基频（音高）与可信度
            "azimuth": round(r["azimuth"], 2), "elevation": r["elevation"],
            "distance": r["distance"],
        }]

        # ---- 起始点检测：正向频谱通量 + 自适应阈值 ----
        flux = 0.0 if self.prev_bands is None else float(np.maximum(bands - self.prev_bands, 0).sum())
        self.prev_bands = bands
        med = float(np.median(self.flux_hist)) if self.flux_hist else 0.0
        self.flux_hist.append(flux)
        is_onset = (flux > med + c.onset_delta and rms_n > c.onset_gate
                    and t - self.last_onset > c.onset_min_gap)

        ev = self.event
        if ev is not None:
            ended = (is_onset
                     or t - ev["t_start"] > c.event_max_dur
                     or (t - ev["t_start"] > 0.03 and rms_n < ev["rms_peak"] * c.event_release))
            if ended:
                msgs.extend(self._finish_event(t))
                ev = None
            else:
                ev["bands"] += bands; ev["n"] += 1
                ev["centroid"] += r["centroid"]; ev["tonality"] += tonality
                ev["azimuth"] += r["azimuth"]; ev["rms_peak"] = max(ev["rms_peak"], rms_n)
                ev["rms_abs"] = max(ev["rms_abs"], r["rms"])
        if is_onset:
            self.last_onset = t
            self.event = {"t_start": t, "bands": bands.copy(), "n": 1,
                          "centroid": r["centroid"], "tonality": tonality,
                          "azimuth": r["azimuth"], "rms_peak": rms_n, "rms_abs": r["rms"]}
        return msgs

    # ------------------------------------------------------------------
    def _finish_event(self, t_end: float) -> list[dict]:
        c = self.cfg
        ev, self.event = self.event, None
        if ev is None or len(self.nodes) >= c.max_nodes:
            return []
        n = ev["n"]
        bands = ev["bands"] / n
        centroid = ev["centroid"] / n
        tonality = ev["tonality"] / n
        nid = len(self.nodes)

        # 形状向量：去均值 + 单位化 → 相似度与响度无关
        shape = bands - bands.mean()
        shape = shape / (np.linalg.norm(shape) + 1e-9)

        cx = np.clip((np.log2(max(centroid, 50)) - np.log2(100)) / (np.log2(10000) - np.log2(100)), 0, 1)
        axes = [(cx * 2 - 1) * SPACE, (ev["rms_peak"] * 2 - 1) * SPACE, (tonality * 2 - 1) * SPACE]

        node = {
            "id": nid, "t": round(ev["t_start"], 3), "t_end": round(t_end, 3),
            "duration": round(t_end - ev["t_start"], 3),
            "centroid": round(centroid, 1), "amplitude": round(ev["rms_peak"], 3),
            "rms_abs": round(ev["rms_abs"], 4),
            "tonality": round(tonality, 3), "azimuth": round(ev["azimuth"] / n, 2),
            "bands": np.round(bands, 3).tolist(),
            "axes": [round(float(v), 3) for v in axes],
            "pca": None,
        }

        new_edges: list[tuple[int, int, int]] = []
        if self.last_node_time is not None and ev["t_start"] - self.last_node_time < c.temporal_gap and nid > 0:
            new_edges.append((nid - 1, nid, 0))
        if self.shape_vecs:
            sims = np.stack(self.shape_vecs) @ shape
            for j in np.argsort(-sims)[: c.sim_k]:
                if sims[j] >= c.sim_threshold and not (new_edges and new_edges[0][0] == j):
                    new_edges.append((int(j), nid, 1))

        self.nodes.append(node); self.shape_vecs.append(shape)
        self.edges.extend(new_edges)
        self.last_node_time = t_end

        msgs: list[dict] = []
        if self.pca is not None:
            node["pca"] = self._project(shape)
        elif len(self.nodes) >= c.pca_after:
            self._fit_pca()
            msgs.append({"type": "pca_ready",
                         "coords": {str(nd["id"]): nd["pca"] for nd in self.nodes}})
        msgs.insert(0, {"type": "event", "node": node,
                        "edges": [list(e) for e in new_edges]})
        return msgs

    def _fit_pca(self) -> None:
        X = np.stack(self.shape_vecs)
        mean = X.mean(axis=0)
        _, _, vt = np.linalg.svd(X - mean, full_matrices=False)
        comps = vt[:3]
        if comps.shape[0] < 3:  # 理论上不会发生（pca_after ≥ 3）
            comps = np.vstack([comps, np.zeros((3 - comps.shape[0], X.shape[1]))])
        proj = (X - mean) @ comps.T
        scale = np.percentile(np.abs(proj), 95, axis=0) + 1e-9
        self.pca = (mean, comps, scale)
        for nd, v in zip(self.nodes, self.shape_vecs):
            nd["pca"] = self._project(v)

    def _project(self, v: np.ndarray) -> list[float]:
        mean, comps, scale = self.pca
        p = np.clip(((v - mean) @ comps.T) / scale * SPACE, -1.5 * SPACE, 1.5 * SPACE)
        return [round(float(x), 3) for x in p]

    # ------------------------------------------------------------------
    def export_graph(self) -> dict:
        """导出 GNN 可用的图：
        x          : 每个节点的特征向量 [64 频段均值, 质心(对数归一), 峰值响度, 音调性, 时长]
        edge_index : [[src...], [dst...]]（PyTorch Geometric 约定）
        edge_type  : 0 = 时序边, 1 = 相似边
        """
        x = []
        for nd in self.nodes:
            lc = (np.log2(max(nd["centroid"], 50)) - np.log2(100)) / (np.log2(10000) - np.log2(100))
            x.append(nd["bands"] + [round(float(lc), 4), nd["amplitude"], nd["tonality"], nd["duration"]])
        return {
            "format": "neurosense-graph-v1",
            "sr": self.sr, "channels": self.ch,
            "band_centers": np.round(self.band_centers, 1).tolist(),
            "feature_names": [f"band_{i}" for i in range(len(self.band_centers))]
                             + ["log_centroid", "amplitude", "tonality", "duration"],
            "nodes": self.nodes,
            "x": x,
            "edge_index": [[e[0] for e in self.edges], [e[1] for e in self.edges]],
            "edge_type": [e[2] for e in self.edges],
        }
