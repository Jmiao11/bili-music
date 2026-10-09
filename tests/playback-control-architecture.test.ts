import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

const clickExceptions = [
  {
    "file": "ui/main.ts",
    "line": "homeHintApply?.click();",
    "reason": "首页表单提交与打开设置，不属于播放控制"
  },
  {
    "file": "ui/main.ts",
    "line": "document.querySelector<HTMLButtonElement>(\"#open-settings-button\")?.click();",
    "reason": "首页表单提交与打开设置，不属于播放控制"
  },
  {
    "file": "ui/library-view.ts",
    "line": "for (const node of [input, linkInput]) node.addEventListener(\"keydown\", event => { if (event.key === \"Enter\") { event.preventDefault(); primaryButton.click(); } });",
    "reason": "资料库弹窗回车提交，不属于播放控制"
  },
  {
    "file": "ui/library-view.ts",
    "line": "input.addEventListener(\"keydown\", event => { if (event.key === \"Enter\") { event.preventDefault(); primaryButton.click(); } });",
    "reason": "资料库弹窗回车提交，不属于播放控制"
  },
  {
    "file": "ui/library-view.ts",
    "line": "input.addEventListener(\"keydown\", event => { if (event.key === \"Enter\") { event.preventDefault(); primaryButton.click(); } });",
    "reason": "资料库弹窗回车提交，不属于播放控制"
  },
  {
    "file": "ui/mini-player-host.ts",
    "line": "previousButton?.click();",
    "reason": "classic 脚本迷你窗宿主，state-8b 移除",
    "removeIn": "state-8b"
  },
  {
    "file": "ui/mini-player-host.ts",
    "line": "playPauseButton?.click();",
    "reason": "classic 脚本迷你窗宿主，state-8b 移除",
    "removeIn": "state-8b"
  },
  {
    "file": "ui/mini-player-host.ts",
    "line": "nextButton?.click();",
    "reason": "classic 脚本迷你窗宿主，state-8b 移除",
    "removeIn": "state-8b"
  },
  {
    "file": "ui/mini-player-host.ts",
    "line": "favoriteButton?.click();",
    "reason": "classic 脚本迷你窗宿主，state-8b 移除",
    "removeIn": "state-8b"
  }
] as const;
const expected = [
  {
    "file": "ui/main.ts",
    "line": "homeHintApply?.click();",
    "reason": "首页表单提交与打开设置，不属于播放控制"
  },
  {
    "file": "ui/main.ts",
    "line": "document.querySelector<HTMLButtonElement>(\"#open-settings-button\")?.click();",
    "reason": "首页表单提交与打开设置，不属于播放控制"
  },
  {
    "file": "ui/library-view.ts",
    "line": "for (const node of [input, linkInput]) node.addEventListener(\"keydown\", event => { if (event.key === \"Enter\") { event.preventDefault(); primaryButton.click(); } });",
    "reason": "资料库弹窗回车提交，不属于播放控制"
  },
  {
    "file": "ui/library-view.ts",
    "line": "input.addEventListener(\"keydown\", event => { if (event.key === \"Enter\") { event.preventDefault(); primaryButton.click(); } });",
    "reason": "资料库弹窗回车提交，不属于播放控制"
  },
  {
    "file": "ui/library-view.ts",
    "line": "input.addEventListener(\"keydown\", event => { if (event.key === \"Enter\") { event.preventDefault(); primaryButton.click(); } });",
    "reason": "资料库弹窗回车提交，不属于播放控制"
  },
  {
    "file": "ui/mini-player-host.ts",
    "line": "previousButton?.click();",
    "reason": "classic 脚本迷你窗宿主，state-8b 移除",
    "removeIn": "state-8b"
  },
  {
    "file": "ui/mini-player-host.ts",
    "line": "playPauseButton?.click();",
    "reason": "classic 脚本迷你窗宿主，state-8b 移除",
    "removeIn": "state-8b"
  },
  {
    "file": "ui/mini-player-host.ts",
    "line": "nextButton?.click();",
    "reason": "classic 脚本迷你窗宿主，state-8b 移除",
    "removeIn": "state-8b"
  },
  {
    "file": "ui/mini-player-host.ts",
    "line": "favoriteButton?.click();",
    "reason": "classic 脚本迷你窗宿主，state-8b 移除",
    "removeIn": "state-8b"
  }
] as const;

test("playback click exceptions exactly match approved long-term and temporary entries", () => {
  assert.deepEqual(clickExceptions, expected);
  assert.equal(clickExceptions.filter(item => "removeIn" in item).length, 4);
  for (const item of clickExceptions) if ("removeIn" in item) {
    assert.equal(item.removeIn, "state-8b"); assert.ok(item.reason.includes(item.removeIn));
  }
});

function checkClicks(root: string) {
  const seen = new Set<number>();
  for (const file of fs.readdirSync(root).filter(name => name.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(root, file), "utf8"), masked = maskCommentsAndStrings(source);
    for (const match of masked.matchAll(/\.\s*click\s*\(/g)) {
      const line = source.slice(0, match.index).split("\n").length;
      const raw = source.split("\n")[line - 1].trim();
      const index = clickExceptions.findIndex((item, index) => !seen.has(index) && item.file === `ui/${file}` && item.line === raw);
      assert.ok(index >= 0, `Unregistered click: ui/${file}:${line}`); seen.add(index);
    }
  }
  assert.equal(seen.size, clickExceptions.length);
}

test("ui playback controls contain no unregistered simulated clicks", () => { checkClicks(path.join(import.meta.dirname, "../ui")); });
