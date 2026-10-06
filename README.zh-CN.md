# NeuroSense · 多模态感知与认知神经网络

**[English](README.md) | 简体中文**

把声音（音频文件、视频、麦克风直播）实时变成 3D 可视化与可训练的图数据。全部在你自己的电脑上运行：Python 后端负责分析，浏览器负责显示，音频不会上传到任何服务器。

当前版本：**v0.7**

---

## 界面

```
┌──────── 工具栏：输入源 · 播放 · 色带 · 音高范围 · 时间窗 · 字幕 · 识别状态 ────────┐
├────────────────────┬─────────────────────────┬───────────────────────┤
│ 声学映射网络         │ 神经网络 · 实时训练        │ 3D 声音空间（音乐坐标）   │
│ 事件节点 + 连线 + 字幕 │ MLP 权重 / 前向 / 反向 / 损失 │ 声像 × 时间 × 音高       │
├────────────────────┼─────────────────────────┼───────────────────────┤
│ 多道分析记录          │ 训练代码 · 3D 执行视图      │ 声学轨迹 3D（闪电）       │
│ 频谱 / 色度 / 振幅 …   │ 源代码随训练逐行高亮 + 日志  │ 3D 游走轨迹 + 雷击        │
└────────────────────┴─────────────────────────┴───────────────────────┘
```

每个面板左上角的下拉框都可以切换成其它模块。窄屏（手机）下面板纵向排列。

---

## 快速开始

### 需要

- **Python 3.10 或更高**（只用基础功能时 3.14 也可以；要用识别功能建议 3.12，见下文）
- **Chrome / Edge / Firefox** 浏览器
- 约 100 MB 磁盘空间（不含识别模型）

### Windows

1. 安装 Python：到 <https://www.python.org/downloads/> 下载安装，**安装时勾选 “Add python.exe to PATH”**。
2. 下载本项目：GitHub 页面 → 绿色 **Code** 按钮 → **Download ZIP**，解压到任意位置（路径最好不含中文和空格，例如 `D:\neurosense`）。
   或者用 Git：`git clone https://github.com/tianmingliu-pixel/Sound-network-neuron.git`
3. 双击 **`start.bat`**。第一次运行会自动安装基础依赖（约 1 分钟），然后自动打开 <http://127.0.0.1:8000>。

### macOS / Linux

```bash
git clone https://github.com/tianmingliu-pixel/Sound-network-neuron.git neurosense
cd neurosense
chmod +x start.sh
./start.sh
```

浏览器打开 <http://127.0.0.1:8000>。

### 开始使用

- **文件 / 视频**：从下拉列表选择文件，点「上传」或直接把文件拖到页面上，然后点「播放」。首次启动会自动生成一个演示音 `demo.wav`。
- **直播**：切到「直播」，点「开始直播」，在浏览器弹窗中允许麦克风（和摄像头）。
- **退出**：在运行服务器的黑色窗口里按 `Ctrl + C`，或直接关闭窗口。

> 不装识别功能也能使用全部可视化，以及「神经网络 · 实时训练」的“自编码”模式。

---

## 识别功能（可选）：字幕 / 声音类别 / 鸟种

| 识别 | 模型 | 例子 |
|---|---|---|
| 语音字幕 | Whisper（faster-whisper），99 种语言，自动识别语种 | `[英语] Hello there` |
| 声音类别 | AST，AudioSet 527 类，归为 9 大类 | `音乐 46%`、`动物 · 鸟鸣 82%` |
| 鸟种 | BirdNET，6000+ 鸟种，检测到鸟叫时才调用 | `Erithacus rubecula 81%` |

识别全部在本机 CPU 上运行（AMD 显卡也可以）。字幕比说话慢 2–5 秒属于正常。

### Windows 一键安装（推荐）

双击 **`install-ai.bat`**。它会建立一个 Python 3.12 的独立环境 `backend\.venv`，安装 faster-whisper、torch、transformers、birdnetlib、tensorflow，并预先下载模型。之后照常用 `start.bat` 启动，它会自动使用这个环境。

网络不稳定时（SSL 报错、下载很慢），在 PowerShell 中运行：`.\install-ai.bat -Mirror`

### 手动安装（任何系统）

```bash
cd backend
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install faster-whisper transformers          # 字幕 + 声音类别
python -m pip install birdnetlib tensorflow librosa        # 鸟种（需要 Python ≤ 3.12）
python download_models.py                                   # 下载模型到 backend/models/
python server.py
```

- 只装需要的部分即可：只装 `faster-whisper` 就只有字幕。
- 检查安装情况：`python check_ai.py`，结果同时保存在 `backend/ai_check.txt`。
- 完全关闭识别：`python server.py --no-ai`
- 工具栏右上角的状态显示 **字幕✓ 声音✓ 鸟种✓** 表示就绪。

### 模型下载

`download_models.py` 用系统自带的 `curl` 下载（支持断点续传），保存到 `backend/models/`，启动时优先使用本地模型：

```bash
python download_models.py            # 从 huggingface.co 下载
python download_models.py --mirror   # 从 hf-mirror.com 镜像下载（中国大陆更快）
python download_models.py small      # 改用 Whisper small（更准，更慢）
```

Whisper base 约 150 MB，AST 约 350 MB。

### 设置（环境变量）

| 变量 | 作用 |
|---|---|
| `NEUROSENSE_WHISPER` | `tiny` / `base`（默认）/ `small` / `medium` / `large-v3` |
| `NEUROSENSE_LAT`、`NEUROSENSE_LON` | 录音地点经纬度，BirdNET 按地区过滤鸟种 |
| `HF_ENDPOINT` | 模型下载镜像，例如 `https://hf-mirror.com` |

Windows PowerShell 写法：`$env:NEUROSENSE_WHISPER="small"`；macOS / Linux：`export NEUROSENSE_WHISPER=small`

---

## 常见问题

| 现象 | 解决 |
|---|---|
| 双击 `start.bat` 提示找不到 Python | 重新安装 Python 并勾选 “Add python.exe to PATH” |
| `pip` 报 `SSL: RECORD_LAYER_FAILURE` 或下载中断 | 网络干扰了 Python 的加密连接。在 `backend` 目录运行 `python install_ai_curl.py`（改用 curl 下载，可续传），或加 `--mirror` 用清华镜像 |
| 启动后报 `CAS Client Error` / `error decoding response body` | 模型下载被中断。运行 `python download_models.py`（或加 `--mirror`），再重启 |
| 识别状态显示“未安装” | 对应的包没装，见上文「识别功能」 |
| 鸟种在 Python 3.14 上装不上 | TensorFlow 还没有 3.14 版本。用 `install-ai.bat`（自动建 3.12 环境），或只用字幕和声音类别 |
| 页面布局没更新 | 浏览器缓存：按 `Ctrl + F5` 强制刷新 |
| 某个视频 / 音频放不出来 | 会自动转码；也可以先转成 MP3 / MP4 再上传 |
| 端口 8000 被占用 | 关闭另一个正在运行的 NeuroSense 窗口 |

---

## 模块说明

| 模块 | 内容 |
|---|---|
| **声学映射网络** | 每个声音事件（音节、音符、鼓点）是一个节点；白线 = 时间顺序，青线 = 频谱相似。连线随时间变细褪色。坐标可切换「固定轴」或「PCA」。顶部显示字幕。 |
| **神经网络 · 实时训练** | 在浏览器里训练一个小型多层感知机（31→20→14→9）。“蒸馏”模式：只看 31 个声学特征，学习模仿 AST 的 9 大类判断；“自编码”模式：把特征压缩到 3 维再还原，不需要识别模型。显示权重（橙正蓝负）、前向（青）/ 反向（品红）脉冲、损失与一致率曲线。 |
| **训练代码 · 3D 执行视图** | 训练模块自己的源代码（运行时从 `train.js` 读取）放在 3D 执行环上：① 特征 → ② 前向 → ③ 损失 → ④ 反向 → ⑤ Adam → ⑥ 验证。与上方动画同步，正在执行的代码卡片飞到镜头前逐行高亮，并显示当时的真实数值和训练日志。 |
| **3D 声音空间（音乐坐标）** | X = 声像（左—右），Y = 时间，Z = 音高（YIN 基频，按音符刻度）；颜色与大小 = 力度（pp–ff）。可开启音符吸附。 |
| **多道分析记录** | 频谱图、色度图、振幅、频谱质心、音调性、事件、识别结果，按时间滚动；悬停读数。 |
| **声学轨迹 3D** | 地震仪式的 3D 游走轨迹：x = 音色（频谱质心），y = 音高或音调性，z = 时间；颜色 = 振幅。「闪电 · 夜空」特效：强起音时从空中劈下分叉闪电，地面扩散冲击环。可选视角、旋转速度。 |
| 其它可选 | 声音识别仪表（9 大类强度条）、字幕与标签记录（筛选、导出 SRT / CSV）、多尺度分析 3D、振幅 × 质心散点、空间粒子环 |

工具栏的「色带」「音高范围」（预设 / 自适应 / 自定义）作用于所有和音高有关的模块。

---

## 导出给 GNN

点「导出图」得到 `<文件名>.graph.json`：

| 字段 | 内容 |
|---|---|
| `x` | 节点特征，每个节点 68 维：64 个频段均值 + 对数质心、振幅、音调性、时长 |
| `edge_index` | `[[源...], [目标...]]`，PyTorch Geometric 约定 |
| `edge_type` | 0 = 时序边，1 = 相似边 |
| `nodes` | 每个节点的时间戳、坐标等完整信息 |

```python
import json, torch
from torch_geometric.data import Data

g = json.load(open("demo.graph.json"))
data = Data(x=torch.tensor(g["x"], dtype=torch.float),
            edge_index=torch.tensor(g["edge_index"], dtype=torch.long),
            edge_type=torch.tensor(g["edge_type"], dtype=torch.long))
```

---

## 工作原理

```
<video> 文件 / 麦克风 → AudioWorklet 截取 PCM（48 kHz）
     → WebSocket → 后端 StreamSession：STFT 64 频带、频谱质心、音调性、色度、YIN 基频、事件切分、建图
     ← 特征帧（60 fps）+ 事件节点 + 边 ← 识别引擎（后台线程：Whisper / AST / BirdNET）
     → 浏览器各模块绘制（three.js）；「实时训练」用这些特征和 AST 标签在浏览器里训练
```

- 浏览器负责解码所有媒体格式；浏览器不支持的格式（WMA、AIFF、AVI、WMV 等）由后端用 ffmpeg 自动转码（`imageio-ffmpeg` 自带 ffmpeg）。
- 直播时关闭浏览器的回声消除、降噪和自动增益，保留原始信号。

## 文件结构

```
start.bat / start.sh      一键启动
install-ai.bat            Windows：一键安装识别功能
backend/
  server.py               HTTP + WebSocket 服务
  stream_engine.py        流式分析与建图
  audio_engine.py         STFT、YIN 基频、演示音生成
  recognizers.py          识别引擎（Whisper / AST / BirdNET）
  labels_zh.py            中文标签与 9 大类分组
  media_io.py             上传：文件名清洗、格式识别、转码
  download_models.py      用 curl 下载识别模型
  install_ai_curl.py      用 curl 安装 Python 包（绕过 pip 下载中断）
  check_ai.py             识别功能自检
  requirements.txt        基础依赖
  requirements-ai.txt     识别功能依赖（可选）
frontend/
  index.html  style.css  main.js  layout.js（面板布局与模块注册）
  audio-io.js  worklet.js  palette.js
  core/                   store（共享数据）、panel（面板框架）、three-base（3D 基类）
  modules/                各可视化模块（manifold、train、codeview、space3d、recorder、seismo …）
```

## 扩展：新增一个模块

1. 在 `frontend/modules/` 新建一个类（接口见 `core/panel.js` 顶部注释），数据从共享的 `store` 读取：

```js
export class MyModule {
  static title = "我的模块";
  constructor({ body, tools, store }) {}
  onFrame(frame) {}        // 每帧特征（可选）
  onEvent(node, edges) {}  // 每个声音事件（可选）
  render(now) {}           // 每个动画帧
  resize(w, h) {}
  dispose() {}
}
```

2. 在 `frontend/layout.js` 的 `REGISTRY` 中注册，并加到某个面板的 `options`。
3. 3D 模块可以继承 `core/three-base.js` 的 `ThreeModule`。

## 已知限制

- 方位只来自左右声道的能量差（声像），不是真正的三维声源定位。
- 「实时训练」的权重只保存在浏览器内存中，刷新页面后重新训练。
- 首次打开页面需要联网加载 three.js（来自 unpkg.com）。

## 路线图

- [x] v0.2 三种输入源、流式分析、声学流形、图导出
- [x] v0.4 识别：多语种字幕、AudioSet 声音类别、BirdNET 鸟种
- [x] v0.6 音乐坐标 3D 空间、3D 闪电轨迹、多格式上传与转码
- [x] v0.7 神经网络实时训练 + 训练代码 3D 执行视图
- [ ] 后端 PyTorch 训练，权重可保存，前端同步显示
- [ ] Demucs 音源分离：每个声源一条独立轨迹
- [ ] 视觉分支：DINOv2 → 场景图 → GNN，与声音事件图融合
- [ ] 麦克风阵列 + SELD 声源定位
