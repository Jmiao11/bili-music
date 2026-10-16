import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { maskCommentsAndStrings } from "./helpers/js-source.ts";

const clickExceptions = [
  {
    "file": "ui/app/main.ts",
    "line": "homeHintApply?.click();",
    "reason": "首页表单提交与打开设置，不属于播放控制"
  },
  {
    "file": "ui/app/main.ts",
    "line": "document.querySelector<HTMLButtonElement>(\"#open-settings-button\")?.click();",
    "reason": "首页表单提交与打开设置，不属于播放控制"
  }
] as const;
const expected = [
  {
    "file": "ui/app/main.ts",
    "line": "homeHintApply?.click();",
    "reason": "首页表单提交与打开设置，不属于播放控制"
  },
  {
    "file": "ui/app/main.ts",
    "line": "document.querySelector<HTMLButtonElement>(\"#open-settings-button\")?.click();",
    "reason": "首页表单提交与打开设置，不属于播放控制"
  }
] as const;

test("playback click exceptions exactly match approved long-term and temporary entries", () => {
  assert.deepEqual(clickExceptions, expected);
  assert.equal(clickExceptions.filter(item => "removeIn" in item).length, 0);
});

function checkClicks(root: string) {
  const seen = new Set<number>();
  for (const file of fs.readdirSync(root, { recursive: true }).map(name => String(name).replace(/\\/g, "/")).filter(name => name.endsWith(".ts"))) {
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
