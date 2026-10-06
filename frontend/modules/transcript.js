// 模块：字幕与标签记录
//   按时间列出：语音字幕（原文 + 语言标签）、声音类别、鸟种
//   点击任一条跳到该时刻；可筛选类型；导出 SRT（字幕）或 CSV（全部）

import { GROUPS, groupColor } from "../palette.js";

const fmt = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export class TranscriptModule {
  static title = "字幕与标签";

  constructor({ body, tools, store, hooks }) {
    this.store = store;
    this.hooks = hooks;
    this.show = { captions: true, sounds: true, birds: true };
    this.sig = "";
    this.list = document.createElement("div");
    this.list.className = "transcript";
    body.appendChild(this.list);

    tools.innerHTML = `
      <div class="seg mini" role="group" aria-label="筛选">
        <button data-f="captions" class="on">字幕</button>
        <button data-f="sounds" class="on">声音</button>
        <button data-f="birds" class="on">鸟种</button>
      </div>
      <button class="btn mini" data-x="srt">导出 SRT</button>
      <button class="btn mini" data-x="csv">导出 CSV</button>`;
    tools.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => {
      this.show[b.dataset.f] = !this.show[b.dataset.f];
      b.classList.toggle("on", this.show[b.dataset.f]);
      this.sig = "";
    });
    tools.querySelector("[data-x=srt]").onclick = () => this._srt();
    tools.querySelector("[data-x=csv]").onclick = () => this._csv();
    this.list.addEventListener("click", (e) => {
      const row = e.target.closest("[data-t]");
      if (row) this.hooks.seek?.(+row.dataset.t);
    });
  }

  _rows() {
    const s = this.store, rows = [];
    if (this.show.captions) for (const c of s.captions) rows.push({ t: c.t, kind: "caption", c });
    if (this.show.sounds) {
      // 相邻且主类别相同的声音结果合并成一条，避免刷屏
      let prev = null;
      for (const x of s.sounds) {
        const top = x.labels[0];
        if (!top) continue;
        if (prev && prev.top.en === top.en && x.t - prev.t_end < 2.5) { prev.t_end = x.t_end; prev.score = Math.max(prev.score, top.score); continue; }
        prev = { t: x.t, t_end: x.t_end, kind: "sound", top, score: top.score, rest: x.labels.slice(1, 3) };
        rows.push(prev);
      }
    }
    if (this.show.birds) for (const b of s.birds) rows.push({ t: b.t, kind: "bird", b });
    return rows.sort((a, b) => a.t - b.t);
  }

  render() {
    const s = this.store;
    const ai = s.ai ? `${s.ai.speech}${s.ai.sound}${s.ai.bird}${s.ai.disabled}` : "";
    const sig = `${s.captions.length}|${s.sounds.length}|${s.birds.length}|${this.show.captions}${this.show.sounds}${this.show.birds}|${ai}`;
    // 高亮当前时间的行（每帧更新很便宜）
    if (sig === this.sig) { this._highlight(); return; }
    this.sig = sig;
    const rows = this._rows();
    const atBottom = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 30;
    if (!rows.length) {
      this.list.innerHTML = `<p class="empty">${this._emptyText()}</p>`;
      return;
    }
    this.list.innerHTML = rows.map((r) => {
      if (r.kind === "caption") {
        return `<div class="row cap" data-t="${r.t}" data-te="${r.c.t_end}"><span class="tm">${fmt(r.t)}</span>
          <span class="tag lang">${esc(r.c.lang_name)}</span><span class="txt" translate="no">${esc(r.c.text)}</span></div>`;
      }
      if (r.kind === "sound") {
        const g = r.top.group;
        return `<div class="row" data-t="${r.t}" data-te="${r.t_end}"><span class="tm">${fmt(r.t)}</span>
          <span class="tag" style="--c:${groupColor(g)}">${GROUPS[g]?.name ?? "其它"}</span>
          <span class="txt">${esc(r.top.zh)} <em>${Math.round(r.score * 100)}%</em>
          ${r.rest.map((l) => `<small>${esc(l.zh)}</small>`).join("")}</span></div>`;
      }
      const sp = r.b.species;
      return `<div class="row" data-t="${r.t}" data-te="${r.b.t_end}"><span class="tm">${fmt(r.t)}</span>
        <span class="tag" style="--c:${groupColor("species")}">鸟种</span>
        <span class="txt"><i>${esc(sp[0].sci)}</i> ${esc(sp[0].common)} <em>${Math.round(sp[0].conf * 100)}%</em>
        ${sp.slice(1).map((x) => `<small><i>${esc(x.sci)}</i></small>`).join("")}</span></div>`;
    }).join("");
    if (atBottom) this.list.scrollTop = this.list.scrollHeight;
    this._highlight();
  }

  _highlight() {
    const t = this.store.time;
    for (const row of this.list.children) {
      if (!row.dataset) continue;
      const on = +row.dataset.t <= t + 0.05 && t <= +row.dataset.te + 0.5;
      row.classList.toggle("now", on);
    }
  }

  _emptyText() {
    const ai = this.store.ai;
    if (!ai) return "等待识别引擎…";
    if (ai.disabled) return "识别功能已关闭（服务以 --no-ai 启动）";
    return `识别引擎状态<br>字幕：${esc(ai.speech)}<br>声音：${esc(ai.sound)}<br>鸟种：${esc(ai.bird)}<br><br>播放音频或开始直播后，结果会显示在这里。`;
  }

  _download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  _srt() {
    const ts = (t) => {
      const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60;
      const s = Math.floor(ms / 1000) % 60, r = ms % 1000;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
    };
    const srt = this.store.captions.map((c, i) =>
      `${i + 1}\n${ts(c.t)} --> ${ts(Math.max(c.t_end, c.t + 0.5))}\n[${c.lang_name}] ${c.text}\n`).join("\n");
    this._download("captions.srt", srt, "text/plain;charset=utf-8");
  }

  _csv() {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [["开始(s)", "结束(s)", "类型", "内容", "语言/分组", "置信度"].join(",")];
    for (const c of this.store.captions) lines.push([c.t, c.t_end, "字幕", q(c.text), q(c.lang_name), c.lang_prob].join(","));
    for (const x of this.store.sounds) for (const l of x.labels)
      lines.push([x.t, x.t_end, "声音", q(`${l.zh} (${l.en})`), q(GROUPS[l.group]?.name ?? l.group), l.score].join(","));
    for (const b of this.store.birds) for (const sp of b.species)
      lines.push([b.t, b.t_end, "鸟种", q(`${sp.sci} / ${sp.common}`), "鸟种", sp.conf].join(","));
    this._download("recognition.csv", "﻿" + lines.join("\n"), "text/csv;charset=utf-8");
  }
}
