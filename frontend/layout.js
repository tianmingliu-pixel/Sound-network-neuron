// 布局配置：改这里就能调整面板位置、默认模块和可切换的模块。
//
// 新增一个模块：
//   1. 在 modules/ 下写一个类（接口见 core/panel.js 顶部注释）
//   2. 在 REGISTRY 里注册
//   3. 把它的 key 加到某个面板的 options 里
//
// area 对应 style.css 中 .workspace 的 grid-template-areas（上排三格：左 / 中 / 右；下排三格：左 / 中 / 右）。

import { ManifoldModule } from "./modules/manifold.js";
import { RecorderModule } from "./modules/recorder.js";
import { Space3DModule } from "./modules/space3d.js";
import { ParticlesModule } from "./modules/particles.js";
import { MultiScaleModule } from "./modules/multiscale.js";
import { ScatterModule } from "./modules/scatter.js";
import { TranscriptModule } from "./modules/transcript.js";
import { SeismoModule } from "./modules/seismo.js";
import { RecognizeModule } from "./modules/recognize.js";
import { TrainModule } from "./modules/train.js";
import { CodeViewModule } from "./modules/codeview.js";

export const REGISTRY = {
  manifold: ManifoldModule,
  recorder: RecorderModule,
  space3d: Space3DModule,
  particles: ParticlesModule,
  multiscale: MultiScaleModule,
  scatter: ScatterModule,
  transcript: TranscriptModule,
  seismo: SeismoModule,
  recognize: RecognizeModule,
  train: TrainModule,
  codeview: CodeViewModule,
};

export const LAYOUT = [
  { id: "top",      area: "top",      module: "manifold", options: ["manifold", "space3d", "seismo", "multiscale", "particles", "train"] },
  { id: "mid",      area: "mid",      module: "train",    options: ["train", "manifold", "space3d", "seismo", "multiscale", "recognize", "scatter"] },
  { id: "topright", area: "topright", module: "space3d",  options: ["space3d", "manifold", "seismo", "multiscale", "particles", "scatter"] },
  { id: "left",  area: "left",  module: "recorder",   options: ["recorder", "recognize", "transcript", "scatter", "codeview"] },
  { id: "code",  area: "code",  module: "codeview",   options: ["codeview", "recorder", "recognize", "transcript", "seismo", "scatter"] },
  { id: "right", area: "right", module: "seismo",     options: ["seismo", "multiscale", "space3d", "particles", "manifold", "scatter", "transcript"] },
];
