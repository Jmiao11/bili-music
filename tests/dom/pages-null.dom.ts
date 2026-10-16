import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { fixture } from "./pages-fixture.ts";
import { compilePagesRuntime } from "./pages-runtime.ts";


test("pages modal rendering preserves page selection and ignores a missing private context", async t => {
  const h = await fixture(); let disposeRegion = () => {};
  t.after(() => { try { disposeRegion(); } finally { h.dispose(); } });
  const runtime = await compilePagesRuntime();
  const list = h.nodes.pagesModalList, page = { page: 1, cid: 10, part: "第一P", durationSeconds: 60 }, selections: { startPage: unknown; pages: unknown[] }[] = [];
  list.replaceChildren(); list.append("unchanged");
  const context = vm.createContext({ pagesModalContext: null, pagesModalList: list,
    libraryState: { disabledPagePending: new Map(), disabledPages: new Map() },
    document: h.doc,
    pagesModalStatus: h.nodes.pagesModalStatus, pagesModalRestoreAll: h.nodes.pagesModalRestoreAll, pagesModalTitle: h.nodes.pagesModalTitle, pagesModalSub: h.nodes.pagesModalSub, pagesModalClose: h.nodes.pagesModalClose,
    currentPlayableTrack: () => null, currentVideoPage: () => null, isPageDisabled: () => false, formatDuration: () => "1:00",
  });
  context.closePagesModal = () => { context.pagesModalContext = null; };
const project=runtime.createModalProjection();
  context.renderPagesModal=(state: Pick<ReturnType<typeof h.store.getState>["pages"],"modal">, library: Partial<ReturnType<typeof h.store.getState>["library"]>, bindings:Parameters<typeof runtime.installModalBindings>[0])=>{
    if(!state.modal) return;
    runtime.installModalBindings(bindings,null);
    const snapshot=h.store.getState();
    const model=project({...snapshot,pages:{...snapshot.pages,modal:state.modal},library:{...snapshot.library,...library}}).pages;
    list.replaceChildren();
    runtime.render(runtime.h(runtime.PagesList,{...model,...runtime.pagesCallbacks}),list);
  };
  disposeRegion = () => runtime.render(null,list);
  context.renderPagesModal({ modal: context.pagesModalContext }, context.libraryState, { currentTrack: context.currentPlayableTrack, currentPage: context.currentVideoPage, playPage: (selected: unknown) => { const modal = context.pagesModalContext; context.closePagesModal(); modal?.onPlay({ startPage: selected, pages: modal.pages }); } });
  assert.deepEqual(Array.from(list.childNodes, node => node.textContent), ["unchanged"]);
  context.pagesModalContext = { video: { bvid: "BV", title: "视频" }, videos: 1, pages: [page], onPlay: (selection: { startPage: unknown; pages: unknown[] }) => selections.push(selection) };
  context.renderPagesModal({ modal: context.pagesModalContext }, context.libraryState, { currentTrack: context.currentPlayableTrack, currentPage: context.currentVideoPage, playPage: (selected: unknown) => { const modal = context.pagesModalContext; context.closePagesModal(); modal?.onPlay({ startPage: selected, pages: modal.pages }); } });
  assert.equal(list.children.length, 1);
  (list.children[0].children[0] as HTMLButtonElement).click();
  assert.equal(selections[0].startPage, page);
  assert.equal(selections[0].pages[0], page);
  assert.equal(context.pagesModalContext, null);
});
