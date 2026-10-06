// 面板框架：每个面板有一个标题栏（模块切换 + 模块自己的工具）和一个内容区。
// 模块接口（全部可选，除了 render）：
//
//   class MyModule {
//     static title = "显示名称";
//     constructor({ body, tools, store, hooks })  // body: 内容区 DOM；tools: 标题栏右侧工具区
//     onReady(meta) / onFrame(frame) / onEvent(node, edges) / onPca(coords)
//     onClear() / onSettings(settings)
//     render(now)        // 每个动画帧调用
//     resize(w, h)       // 内容区尺寸变化
//     dispose()
//   }

export class Panel {
  constructor(root, { id, area, module, options }, registry, ctx) {
    this.registry = registry;
    this.ctx = ctx;
    this.el = document.createElement("section");
    this.el.className = "panel";
    this.el.id = `panel-${id}`;
    this.el.style.gridArea = area;
    this.el.innerHTML = `
      <header class="panel-head">
        <select class="module-select" aria-label="切换模块"></select>
        <div class="panel-tools"></div>
      </header>
      <div class="panel-body"></div>`;
    root.appendChild(this.el);

    this.select = this.el.querySelector(".module-select");
    this.tools = this.el.querySelector(".panel-tools");
    this.body = this.el.querySelector(".panel-body");
    this.select.innerHTML = options
      .map((k) => `<option value="${k}">${registry[k].title}</option>`).join("");
    this.select.onchange = () => this.use(this.select.value);

    this.ro = new ResizeObserver(() => this._resize());
    this.ro.observe(this.body);
    this.use(module);
  }

  use(key) {
    this.module?.dispose?.();
    this.tools.innerHTML = "";
    this.body.innerHTML = "";
    this.key = key;
    this.select.value = key;
    const Mod = this.registry[key];
    this.module = new Mod({ body: this.body, tools: this.tools, ...this.ctx });
    this._resize();
  }

  _resize() {
    const r = this.body.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) this.module?.resize?.(r.width, r.height);
  }

  call(method, ...args) { this.module?.[method]?.(...args); }
}
