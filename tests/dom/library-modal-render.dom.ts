import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./library-modal-fixture.ts";
import { open, type Kind } from "./library-modal-open.ts";

const structures = [
  {
    "kind": "generic",
    "html": "",
    "title": "通用浮层",
    "subtitle": "只读基线",
    "focus": "trigger"
  },
  {
    "kind": "name",
    "html": "<label class=\"library-name-field\"><span>歌单名称</span><input type=\"text\" maxlength=\"40\" placeholder=\"输入歌单名称\"></label><div class=\"library-modal-actions\"><button type=\"button\" class=\"small-button quiet\">取消</button><button type=\"button\" class=\"secondary-button\">创建</button></div>",
    "title": "新建歌单",
    "subtitle": "创建后可以继续加入当前歌曲。",
    "focus": "<input type=\"text\" maxlength=\"40\" placeholder=\"输入歌单名称\">"
  },
  {
    "kind": "delete",
    "html": "<p class=\"library-confirm-copy\">这个操作会移除歌单和其中的条目，之后需要重新创建。</p><div class=\"library-modal-actions\"><button type=\"button\" class=\"small-button quiet\">取消</button><button type=\"button\" class=\"secondary-button danger-action\">删除</button></div>",
    "title": "删除歌单",
    "subtitle": "确认删除“歌单a”？歌曲本身不会被删除。",
    "focus": "trigger"
  },
  {
    "kind": "choose",
    "html": "<div class=\"playlist-picker\"><button type=\"button\" class=\"playlist-choice is-added\" aria-disabled=\"true\"><span>歌单a</span><small>已添加 · 1 首</small></button><button type=\"button\" class=\"playlist-choice\"><span>歌单b</span><small>0 首</small></button></div><div class=\"library-divider\">新建歌单</div><label class=\"library-name-field\"><span>歌单名称</span><input type=\"text\" maxlength=\"40\" placeholder=\"输入歌单名称\"></label><div class=\"library-modal-actions\"><button type=\"button\" class=\"small-button quiet\">取消</button><button type=\"button\" class=\"secondary-button\">新建并加入</button></div>",
    "title": "加入歌单",
    "subtitle": "选择一个歌单，或新建后加入。",
    "focus": "trigger"
  },
  {
    "kind": "favoriteImport",
    "html": "<label class=\"library-name-field\"><span>收藏夹链接</span><input type=\"text\" maxlength=\"4096\" placeholder=\"https://space.bilibili.com/…/favlist?fid=…\"></label><label class=\"library-name-field\" hidden=\"\"><span>歌单名称</span><input type=\"text\" maxlength=\"40\" placeholder=\"输入歌单名称\"></label><div class=\"library-modal-actions\"><button type=\"button\" class=\"small-button quiet\">取消</button><button type=\"button\" class=\"secondary-button\">读取收藏夹</button></div>",
    "title": "导入 B站收藏夹",
    "subtitle": "仅支持公开收藏夹，最多导入 200 个有效视频；失效或无法导入的条目将跳过。",
    "focus": "<input type=\"text\" maxlength=\"4096\" placeholder=\"https://space.bilibili.com/…/favlist?fid=…\">"
  },
  {
    "kind": "purge",
    "html": "<div class=\"unavailable-purge-list\"><div class=\"unavailable-purge-item\"><span class=\"unavailable-purge-cover\"><span class=\"cover-placeholder\"></span></span><span class=\"unavailable-purge-copy\"><strong>曲目1</strong><span class=\"unavailable-purge-reason\">该视频已被删除或设为私密</span><span class=\"unavailable-purge-location\">收藏、歌单《歌单a》</span></span></div></div><div class=\"library-modal-actions\"><button type=\"button\" class=\"small-button quiet\">取消</button><button type=\"button\" class=\"secondary-button\">全部清理</button></div>",
    "title": "清理失效曲目",
    "subtitle": "以下歌曲已无法播放，确认后会从收藏和所有歌单中移除。",
    "focus": "<button type=\"button\" class=\"secondary-button\">全部清理</button>"
  },
  {
    "kind": "loudness",
    "html": "<p class=\"library-confirm-copy\">不同 UP 主上传的音源响度差别很大，切歌时忽大忽小。开启后，播放器会把音量补偿到接近的水平。</p><p class=\"library-confirm-copy\"><strong>需要先测量。</strong>每首歌播放约 30 秒后会自动在后台测量一次，测完才会生效，下次再听就是直接生效的。所以刚开启时你会觉得没什么变化，听一段时间后效果才明显。</p><p class=\"library-confirm-copy\"><strong>只会调小，不会调大。</strong>受浏览器限制只能衰减，整体音量会略低于原先，把系统音量推高一档即可。</p><p class=\"library-confirm-copy\">测量需要重新下载一遍音频，会消耗一些流量。</p><div class=\"library-modal-actions\"><button type=\"button\" class=\"secondary-button\">知道了</button></div>",
    "title": "响度归一化",
    "subtitle": "",
    "focus": "<button type=\"button\" class=\"secondary-button\">知道了</button>"
  }
];

for (const expected of structures) test("library " + expected.kind + " opens with old structure, immediate focus and deferred RAF", async () => {
  const h = await fixture(); try {
    await h.seed(); const trigger = await open(h, expected.kind as Kind);
    const modal = h.nodes.libraryModal, body = h.nodes.libraryModalBody;
    assert.equal(body.innerHTML, expected.html);
    assert.equal(h.nodes.libraryModalTitle.textContent, expected.title);
    assert.equal(h.nodes.libraryModalSubtitle.textContent, expected.subtitle);
    assert.equal(h.nodes.libraryModalSubtitle.hidden, !expected.subtitle);
    assert.equal(h.nodes.libraryModalStatus.getAttribute("role"), "status");
    assert.equal(modal.querySelector("[role=dialog]")?.getAttribute("aria-labelledby"), "library-modal-title");
    assert.equal(modal.querySelector("[role=dialog]")?.getAttribute("aria-modal"), "true");
    assert.equal(modal.hidden, false); assert.equal(modal.classList.contains("is-open"), false);
    assert.equal(modal.getAttribute("aria-hidden"), "true");
    if (expected.focus === "trigger") assert.equal(h.doc.activeElement, trigger);
    else assert.equal(h.doc.activeElement?.outerHTML, expected.focus);
    assert.equal(h.platform.filter(call => call.operation === "requestAnimationFrame").length, 1);
    h.raf(); assert.equal(modal.classList.contains("is-open"), true); assert.equal(modal.getAttribute("aria-hidden"), "false");
    assert.equal(h.state().session.open, true); assert.equal(h.state().session.kind, expected.kind);
  } finally { h.dispose(); }
});

for (const kind of structures.map(item => item.kind as Kind)) test("library " + kind + " Tab has no focus trap 按现状", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, kind); h.raf();
    h.nodes.closeLibraryModalButton.focus();
    const forward = await h.fire(h.nodes.closeLibraryModalButton, "keydown", { key: "Tab" });
    assert.equal(forward.defaultPrevented, false); assert.equal(h.doc.activeElement, h.nodes.closeLibraryModalButton);
    const backward = await h.fire(h.nodes.closeLibraryModalButton, "keydown", { key: "Tab", shiftKey: true });
    assert.equal(backward.defaultPrevented, false); assert.equal(h.doc.activeElement, h.nodes.closeLibraryModalButton);
    if (kind === "favoriteImport") {
      const inputs = [...h.nodes.libraryModalBody.querySelectorAll("input")];
      assert.equal(inputs.length, 2); assert.equal(inputs[1].closest("[hidden]")?.tagName, "LABEL");
    }
    assert.equal(h.state().session.open, true);
  } finally { h.dispose(); }
});

for (const entry of ["Escape", "mask", "close", "cancel"]) test("library closes via " + entry + " and hides only on own transition; no return focus 按现状", async () => {
  const h = await fixture(); try {
    await h.seed(); const trigger = await open(h, "name"); h.raf(); const input = h.input();
    await h.fire(input, "click"); assert.equal(h.state().session.open, true);
    await h.fire(h.nodes.libraryModalBody, "transitionend"); assert.equal(h.nodes.libraryModal.hidden, false);
    await h.fire(h.nodes.libraryModal, "transitionend"); assert.equal(h.nodes.libraryModal.hidden, false);
    if (entry === "Escape") await h.fire(input, "keydown", { key: "Escape" });
    if (entry === "mask") await h.fire(h.nodes.libraryModal, "click");
    if (entry === "close") await h.click(h.nodes.closeLibraryModalButton);
    if (entry === "cancel") await h.click(h.nodes.libraryModalBody.querySelector<HTMLButtonElement>(".quiet")!);
    assert.equal(h.state().session.open, false); assert.equal(h.nodes.libraryModal.classList.contains("is-open"), false);
    assert.equal(h.nodes.libraryModal.getAttribute("aria-hidden"), "true"); assert.equal(h.nodes.libraryModal.hidden, false);
    assert.equal(h.doc.activeElement, input); assert.notEqual(h.doc.activeElement, trigger);
    await h.fire(h.nodes.libraryModalBody, "transitionend"); assert.equal(h.nodes.libraryModal.hidden, false);
    await h.fire(h.nodes.libraryModal, "transitionend"); assert.equal(h.nodes.libraryModal.hidden, true);
    assert.equal(h.doc.activeElement, input);
  } finally { h.dispose(); }
});

test("library Escape before opening RAF is ignored and close before RAF reopens class 按现状", async () => {
  const h = await fixture(); try {
    await h.seed(); await open(h, "name");
    await h.fire(h.input(), "keydown", { key: "Escape" }); assert.equal(h.state().session.open, true);
    await h.click(h.nodes.closeLibraryModalButton); assert.equal(h.state().session.open, false);
    h.raf(); assert.equal(h.nodes.libraryModal.classList.contains("is-open"), true);
    assert.equal(h.nodes.libraryModal.getAttribute("aria-hidden"), "false");
    await h.fire(h.nodes.libraryModal, "transitionend"); assert.equal(h.nodes.libraryModal.hidden, false);
  } finally { h.dispose(); }
});
