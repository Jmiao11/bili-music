import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readFileSync, stripModuleSyntax } from "../helpers/module-syntax.ts";
import { stripTypes } from "../helpers/typescript-source.ts";
import { test } from "node:test";
import { fixture } from "./library-modal-fixture.ts";

test("loudness explanation acknowledge button closes the shared dialog", async () => {
  for (const name of ["features/library/library-view.ts", "features/library/library-ui.ts"]) stripModuleSyntax(readFileSync(path.resolve(import.meta.dirname, "../../ui", name), "utf8"), "ui/" + name);
  stripTypes(fs.readFileSync(path.resolve(import.meta.dirname, "../../ui/features/playback/playback-core.ts"), "utf8"), "ui/features/playback/playback-core.ts");
  const h = await fixture(); try {
    const body = h.nodes.libraryModalBody;
    const opens: { title: string; subtitle: string }[] = [];
    let closes = 0;
    let previous = h.state().session;
    const unsubscribe = h.store.subscribe(state => {
      const modal = state.library.session;
      if (modal.open && modal.version !== previous.version) opens.push({ title: modal.title, subtitle: modal.subtitle });
      if (previous.open && !modal.open) closes += 1;
      previous = modal;
    });
    try {
      const library = h.library as typeof h.library & { openLoudnessModal(): void };
      library.openLoudnessModal();
      assert.equal(opens[0].title, "响度归一化");
      assert.equal(body.children.length, 5);
      assert.equal(body.children[1].children[0].textContent, "需要先测量。");
      assert.equal(body.children[2].children[0].textContent, "只会调小，不会调大。");
      const acknowledgeButton = body.children[4].children[0] as HTMLButtonElement;
      assert.equal(acknowledgeButton.textContent, "知道了");
      assert.equal(h.doc.activeElement, acknowledgeButton);
      acknowledgeButton.click();
      assert.equal(closes, 1);
    } finally { unsubscribe(); }
  } finally { h.dispose(); }
});
