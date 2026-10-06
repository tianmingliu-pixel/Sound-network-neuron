// 模块：声音识别仪表
//   当前最可能的声音（大字）· 鸟种 · 各大类强度条（人类 / 鸟类 / 动物 / 昆虫 / 植物·风声 / 水·天气 / 音乐 / 交通机械 / 其它）
//   · 最近的识别记录。数据来自后端 AudioSet 分类（每 2 s 一次）与 BirdNET。

import { GROUPS, GROUP_ORDER, groupColor } from "../palette.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export class RecognizeModule {
  static title = "声音识别";

  constructor({ body, store, hooks }) {
    this.store = store;
    this.hooks = hooks;
    this.n = 0;
    this.el = document.createElement("div");
    this.el.className = "recog";
    this.el.innerHTML = `
      <div class="recog-now">
        <div class="rn-main"><span class="rn-group"></span><span class="rn-label">等待声音…</span><span class="rn-score"></span></div>
        <div class="rn-sub"></div>
        <div class="rn-bird" hidden></div>
      </div>
      <div class="recog-bars">${GROUP_ORDER.map((g) => `
        <div class="rb" data-g="${g}">
          <span class="rb-name">${GROUPS[g].name}</span>
          <span class="rb-track"><i style="background:${groupColor(g)}"></i></span>
          <span class="rb-val">0%</span>
        </div>`).join("")}
      </div>
      <div class="recog-hist"><div class="rh-title">最近识别</div><div class="rh-list"></div></div>
      <div class="recog-status" hidden></div>`;
    body.appendChild(this.el);
    this.q = (sel) => this.el.querySelector(sel);
    this.bars = Object.fromEntries(GROUP_ORDER.map((g) => {
      const row = this.el.querySelector(`.rb[data-g="${g}"]`);
      return [g, { row, bar: row.querySelector("i"), val: row.querySelector(".rb-val") }];
    }));
    this.q(".rh-list").addEventListener("click", (e) => {
      const r = e.target.closest("[data-t]");
      if (r) this.hooks.seek?.(+r.dataset.t);
    });
  }

  render() {
    if (++this.n % 6) return; // 10 次 / 秒足够
    const s = this.store, t = s.time;
    this._status();
    const snd = s.activeAt("sounds", t, 3.5);
    const bird = s.activeAt("birds", t, 3);

    // 大类强度
    let groups = snd?.groups;
    if (snd && !groups) { // 兼容：只有前几名标签时按标签估算
      groups = {};
      for (const l of snd.labels) groups[l.group] = Math.max(groups[l.group] || 0, l.score);
    }
    let topG = null, topV = 0;
    for (const g of GROUP_ORDER) {
      const v = groups?.[g] ?? 0;
      const b = this.bars[g];
      b.bar.style.width = `${Math.round(v * 100)}%`;
      b.val.textContent = `${Math.round(v * 100)}%`;
      if (v > topV) { topV = v; topG = g; }
    }
    for (const g of GROUP_ORDER) this.bars[g].row.classList.toggle("top", g === topG && topV >= 0.15);

    // 当前声音
    const main = this.q(".rn-main"), sub = this.q(".rn-sub");
    if (snd && snd.labels.length) {
      const l = snd.labels[0];
      main.style.setProperty("--c", groupColor(l.group));
      this.q(".rn-group").textContent = GROUPS[l.group]?.name ?? "其它";
      this.q(".rn-label").textContent = l.zh;
      this.q(".rn-score").textContent = `${Math.round(l.score * 100)}%`;
      sub.innerHTML = snd.labels.slice(1, 4).map((x) =>
        `<span style="--c:${groupColor(x.group)}">${esc(x.zh)} ${Math.round(x.score * 100)}%</span>`).join("");
    } else {
      main.style.setProperty("--c", "#a0a8c0");
      this.q(".rn-group").textContent = "";
      this.q(".rn-label").textContent = s.frames.length ? "（安静 / 尚无结果）" : "等待声音…";
      this.q(".rn-score").textContent = "";
      sub.innerHTML = "";
    }
    const bd = this.q(".rn-bird");
    bd.hidden = !bird;
    if (bird) {
      const b = bird.species[0];
      bd.innerHTML = `<span class="tag">鸟种</span><i>${esc(b.sci)}</i> ${esc(b.common)} <em>${Math.round(b.conf * 100)}%</em>` +
        bird.species.slice(1).map((x) => ` <small><i>${esc(x.sci)}</i> ${Math.round(x.conf * 100)}%</small>`).join("");
    }

    // 最近识别：合并相邻同类，最多 8 条
    const hist = [];
    for (const x of s.sounds) {
      const l = x.labels[0];
      if (!l || l.score < 0.2) continue;
      const prev = hist[hist.length - 1];
      if (prev && prev.en === l.en && x.t - prev.te < 2.5) { prev.te = x.t_end; prev.score = Math.max(prev.score, l.score); continue; }
      hist.push({ t: x.t, te: x.t_end, en: l.en, zh: l.zh, group: l.group, score: l.score });
    }
    for (const b of s.birds) hist.push({ t: b.t, te: b.t_end, zh: `${b.species[0].sci} · ${b.species[0].common}`, group: "species", score: b.species[0].conf });
    hist.sort((a, b) => a.t - b.t);
    const rows = hist.slice(-8).reverse();
    const sig = rows.map((r) => `${r.t}${r.zh}${r.score}`).join("|");
    if (sig !== this.sig) {
      this.sig = sig;
      this.q(".rh-list").innerHTML = rows.map((r) => `
        <div class="rh" data-t="${r.t}"><span class="tm">${r.t.toFixed(1)}s</span>
        <span class="tag" style="--c:${groupColor(r.group)}">${GROUPS[r.group]?.name ?? "其它"}</span>
        <span class="tx">${esc(r.zh)}</span><em>${Math.round(r.score * 100)}%</em></div>`).join("") ||
        `<div class="rh empty">暂无</div>`;
    }
  }

  _status() {
    const a = this.store.ai, box = this.q(".recog-status");
    const ok = (x) => x && x.startsWith("就绪");
    if (!a || (ok(a.sound) && ok(a.bird))) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = a.disabled ? "识别功能已关闭（--no-ai）"
      : `声音分类：${esc(a.sound)}<br>鸟种识别：${esc(a.bird)}`;
  }
}
