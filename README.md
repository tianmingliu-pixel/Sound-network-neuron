# NeuroSense · Multimodal Perception & Cognitive Neural Network

**English | [简体中文](README.zh-CN.md)**

Turn sound (audio files, videos or a live microphone) into real-time 3D visualizations and trainable graph data. Everything runs on your own computer: a Python backend does the analysis and your browser draws it. Your audio is never uploaded to any server.

Current version: **v0.7**

---

## Interface

```
┌──── Toolbar: source · play · palette · pitch range · time window · captions · AI status ────┐
├──────────────────────┬──────────────────────────┬──────────────────────────┤
│ Acoustic manifold     │ Neural net · live training │ 3D sound space (musical)  │
│ event nodes + edges   │ MLP weights / fwd / back   │ pan × time × pitch        │
├──────────────────────┼──────────────────────────┼──────────────────────────┤
│ Multi-track recorder  │ Training code · 3D view    │ Acoustic trajectory 3D    │
│ spectrogram, chroma … │ source lines light up live │ 3D path + lightning       │
└──────────────────────┴──────────────────────────┴──────────────────────────┘
```

The drop-down at the top-left of every panel switches it to another module. On narrow screens (phones) the panels stack vertically.

> **Language:** the **EN / 中文** button in the toolbar switches the whole interface between English and Chinese. The choice is remembered; the first visit follows your browser language. Chinese labels are kept in parentheses below for reference.

---

## Quick start

### Requirements

- **Python 3.10 or newer** (3.14 works for the core features; use 3.12 if you want AI recognition, see below)
- **Chrome, Edge or Firefox**
- About 100 MB of disk space (not counting AI models)

### Windows

1. Install Python from <https://www.python.org/downloads/>. **Tick "Add python.exe to PATH" during setup.**
2. Download this project: on the GitHub page click the green **Code** button → **Download ZIP**, then unzip it anywhere (a path without spaces or non-English characters is safest, e.g. `D:\neurosense`).
   Or with Git: `git clone https://github.com/tianmingliu-pixel/Sound-network-neuron.git`
3. Double-click **`start.bat`**. The first run installs the base packages (about a minute) and then opens <http://127.0.0.1:8000>.

### macOS / Linux

```bash
git clone https://github.com/tianmingliu-pixel/Sound-network-neuron.git neurosense
cd neurosense
chmod +x start.sh
./start.sh
```

Then open <http://127.0.0.1:8000>.

### Using it

- **File / video** (文件 / 视频): pick a file from the list, or click **上传** (Upload) or drag a file onto the page, then press **播放** (Play). A demo tone, `demo.wav`, is generated on first start.
- **Live** (直播): switch to the Live tab, press **开始直播** (Start live) and allow the microphone (and camera) in the browser prompt.
- **Quit**: press `Ctrl + C` in the black server window, or just close it.

> All visualizations, and the "autoencoder" mode of the live-training module, work without the AI recognition packages.

---

## AI recognition (optional): captions / sound classes / bird species

| Recognition | Model | Example |
|---|---|---|
| Speech captions | Whisper (faster-whisper), 99 languages, automatic language detection | `[English] Hello there` |
| Sound classes | AST, AudioSet 527 classes, grouped into 9 categories | `Music 46%`, `Animal · bird song 82%` |
| Bird species | BirdNET, 6,000+ species, only called when birdsong is detected | `Erithacus rubecula 81%` |

Recognition runs on your CPU (AMD GPUs are fine). Captions trailing speech by 2–5 seconds is normal.

### Windows one-click install (recommended)

Double-click **`install-ai.bat`**. It creates a separate Python 3.12 environment in `backend\.venv`, installs faster-whisper, torch, transformers, birdnetlib and tensorflow, and pre-downloads the models. Then start as usual with `start.bat`, which picks up that environment automatically.

On an unreliable network (SSL errors, very slow downloads) run this in PowerShell: `.\install-ai.bat -Mirror`

### Manual install (any OS, recommended: the curl route)

Both the packages and the models are downloaded with the system `curl`: downloads resume after interruptions, retry automatically, and are not affected by networks that interfere with Python's own encrypted connections (which makes plain `pip install` fail with `SSL: RECORD_LAYER_FAILURE` or stop halfway).

```bash
cd backend
python install_ai_curl.py              # installs faster-whisper + torch + transformers (captions + sound classes)
python download_models.py              # downloads the Whisper and AST models into backend/models/
python server.py
```

In mainland China add `--mirror`: `python install_ai_curl.py --mirror` (Tsinghua PyPI mirror), `python download_models.py --mirror` (hf-mirror.com). If either script is interrupted, just run it again; finished parts are kept.

How `install_ai_curl.py` works: pip first only resolves the dependencies to get each file's download URL (a small amount of metadata); curl then downloads **all package files in full** into `backend/wheels/`; finally pip installs from that local folder without going online.

- Bird species (needs Python ≤ 3.12): `python install_ai_curl.py birdnetlib tensorflow librosa`
- Install only what you need, e.g. `python install_ai_curl.py faster-whisper` gives captions only.

<details>
<summary>On a normal network you can also use plain pip</summary>

```bash
cd backend
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install faster-whisper transformers          # captions + sound classes
python -m pip install birdnetlib tensorflow librosa        # bird species (needs Python ≤ 3.12)
python download_models.py
python server.py
```

</details>

- Check your installation: `python check_ai.py` (the report is also saved to `backend/ai_check.txt`).
- Turn recognition off completely: `python server.py --no-ai`
- When the status at the top-right shows **字幕✓ 声音✓ 鸟种✓** (captions / sound / birds), everything is ready.

### Downloading models

`download_models.py` uses the system `curl` (resumable downloads) and saves models to `backend/models/`. The server uses local models first.

```bash
python download_models.py            # download from huggingface.co
python download_models.py --mirror   # download from the hf-mirror.com mirror (faster in mainland China)
python download_models.py small      # use Whisper small instead (more accurate, slower)
```

Whisper base is about 150 MB, AST about 350 MB.

### Settings (environment variables)

| Variable | Effect |
|---|---|
| `NEUROSENSE_WHISPER` | `tiny` / `base` (default) / `small` / `medium` / `large-v3` |
| `NEUROSENSE_LAT`, `NEUROSENSE_LON` | Recording location; BirdNET filters species by region |
| `HF_ENDPOINT` | Model download mirror, e.g. `https://hf-mirror.com` |

Windows PowerShell: `$env:NEUROSENSE_WHISPER="small"`; macOS / Linux: `export NEUROSENSE_WHISPER=small`

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `start.bat` says Python was not found | Reinstall Python and tick "Add python.exe to PATH" |
| `pip` fails with `SSL: RECORD_LAYER_FAILURE` or downloads break off | Something on the network is interfering with Python's encrypted connections. In `backend`, run `python install_ai_curl.py` (downloads with curl, resumable), or add `--mirror` to use the Tsinghua mirror |
| `CAS Client Error` / `error decoding response body` at startup | A model download was interrupted. Run `python download_models.py` (or with `--mirror`), then restart |
| A recognizer shows "未安装" (not installed) | The package is missing; see "AI recognition" above |
| Bird species won't install on Python 3.14 | TensorFlow has no 3.14 build yet. Use `install-ai.bat` (creates a 3.12 environment), or use captions and sound classes only |
| The page layout didn't update | Browser cache: press `Ctrl + F5` to force a reload |
| A video or audio file won't play | It is converted automatically; you can also convert it to MP3 / MP4 before uploading |
| Port 8000 is already in use | Close the other NeuroSense window that is still running |

---

## Modules

| Module (UI label) | What it shows |
|---|---|
| **Acoustic manifold** (声学映射网络) | Each sound event (syllable, note, drum hit) is a node. White lines = time order, cyan lines = spectral similarity. Lines thin and fade with age. Coordinates can be fixed axes or PCA. Captions appear at the top. |
| **Neural net · live training** (神经网络 · 实时训练) | Trains a small multilayer perceptron (31→20→14→9) in the browser. *Distillation* mode: from 31 acoustic features only, it learns to imitate AST's 9-category judgement. *Autoencoder* mode: compresses the features to 3 dimensions and reconstructs them, no AI models needed. Shows weights (orange positive, blue negative), forward (cyan) and backward (magenta) pulses, and loss / agreement curves. |
| **Training code · 3D execution view** (训练代码 · 3D 执行视图) | The training module's own source code (read from `train.js` at runtime) arranged on a 3D execution ring: ① features → ② forward → ③ loss → ④ backward → ⑤ Adam → ⑥ validation. In sync with the animation above, the card being executed flies to the front, its lines light up one by one with the live values of that moment, and a training log scrolls below. |
| **3D sound space, musical axes** (3D 声音空间（音乐坐标）) | X = stereo pan (left–right), Y = time, Z = pitch (YIN fundamental, on a note scale). Colour and size = dynamics (pp–ff). Optional snap-to-note. |
| **Multi-track recorder** (多道分析记录) | Spectrogram, chromagram, amplitude, spectral centroid, tonality, events and recognition results, scrolling in time; hover to read values. |
| **Acoustic trajectory 3D** (声学轨迹 3D) | A seismograph-like path wandering in 3D: x = timbre (spectral centroid), y = pitch or tonality, z = time; colour = amplitude. The "lightning · night sky" effect strikes branching bolts from the sky on strong onsets, with a shock ring spreading on the floor. Selectable viewpoint and rotation speed. |
| Others | Sound recognition meter (9 category bars), captions & labels log (filter, export SRT / CSV), multi-scale analysis 3D, amplitude × centroid scatter, spatial particle ring |

The toolbar's **色带** (palette) and **音高范围** (pitch range: presets / adaptive / custom) apply to every pitch-related module.

---

## Export for GNNs

Click **导出图** (Export graph) to get `<file name>.graph.json`:

| Field | Content |
|---|---|
| `x` | Node features, 68 per node: 64 band means + log centroid, amplitude, tonality, duration |
| `edge_index` | `[[sources...], [targets...]]`, PyTorch Geometric convention |
| `edge_type` | 0 = temporal edge, 1 = similarity edge |
| `nodes` | Full per-node info: timestamps, coordinates, etc. |

```python
import json, torch
from torch_geometric.data import Data

g = json.load(open("demo.graph.json"))
data = Data(x=torch.tensor(g["x"], dtype=torch.float),
            edge_index=torch.tensor(g["edge_index"], dtype=torch.long),
            edge_type=torch.tensor(g["edge_type"], dtype=torch.long))
```

---

## How it works

```
<video> file / microphone → AudioWorklet captures PCM (48 kHz)
     → WebSocket → backend StreamSession: STFT 64 bands, spectral centroid, tonality, chroma,
                   YIN pitch, event segmentation, graph building
     ← feature frames (60 fps) + event nodes + edges ← recognition engine (background thread: Whisper / AST / BirdNET)
     → browser modules draw them (three.js); "live training" trains in the browser on these features and AST labels
```

- The browser decodes all media. Formats it can't play (WMA, AIFF, AVI, WMV, …) are converted by the backend with ffmpeg (bundled via `imageio-ffmpeg`).
- In live mode the browser's echo cancellation, noise suppression and auto gain are turned off to keep the raw signal.

## Project structure

```
start.bat / start.sh      one-click launch
install-ai.bat            Windows: one-click AI recognition install
backend/
  server.py               HTTP + WebSocket server
  stream_engine.py        streaming analysis and graph building
  audio_engine.py         STFT, YIN pitch, demo tone
  recognizers.py          recognition engine (Whisper / AST / BirdNET)
  labels_zh.py            Chinese labels and the 9 categories
  media_io.py             uploads: file-name cleaning, format detection, conversion
  download_models.py      download AI models with curl
  install_ai_curl.py      install Python packages with curl (works around broken pip downloads)
  check_ai.py             AI self-check
  requirements.txt        base dependencies
  requirements-ai.txt     AI dependencies (optional)
frontend/
  index.html  style.css  main.js  layout.js (panel layout and module registry)
  audio-io.js  worklet.js  palette.js
  core/                   store (shared data), panel (panel frame), three-base (3D base class)
  modules/                visualization modules (manifold, train, codeview, space3d, recorder, seismo …)
```

## Adding a module

1. Create a class in `frontend/modules/` (the interface is described at the top of `core/panel.js`) and read data from the shared `store`:

```js
export class MyModule {
  static title = "My module";
  constructor({ body, tools, store }) {}
  onFrame(frame) {}        // per-frame features (optional)
  onEvent(node, edges) {}  // each sound event (optional)
  render(now) {}           // every animation frame
  resize(w, h) {}
  dispose() {}
}
```

2. Register it in `REGISTRY` in `frontend/layout.js` and add it to a panel's `options`.
3. 3D modules can extend `ThreeModule` from `core/three-base.js`.

## Known limitations

- Direction comes only from the left/right level difference (stereo pan); it is not true 3D source localization.
- Live-training weights live in browser memory only; reloading the page starts training over.
- The first page load needs internet access to fetch three.js (from unpkg.com).

## Roadmap

- [x] v0.2 Three input sources, streaming analysis, acoustic manifold, graph export
- [x] v0.4 Recognition: multilingual captions, AudioSet sound classes, BirdNET species
- [x] v0.6 Musical-axes 3D space, 3D lightning trajectory, multi-format upload and conversion
- [x] v0.7 Live neural-network training + 3D view of the training code
- [ ] Backend PyTorch training with saved weights, mirrored in the browser
- [ ] Demucs source separation: one trajectory per source
- [ ] Vision branch: DINOv2 → scene graph → GNN, fused with the sound-event graph
- [ ] Microphone array + SELD sound-source localization
