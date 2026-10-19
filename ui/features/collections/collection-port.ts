let handlers: { open: () => void; close: () => void; retry: () => void; refresh: () => void; favorite: () => void; add: () => void; addAll: () => void; chooseAnchor: (bvid: string) => void; scroll: (event: Event) => void } | null = null;
const collectionCallbacks = {
  open: () => handlers?.open(),
  close: () => handlers?.close(),
  retry: () => handlers?.retry(),
  refresh: () => handlers?.refresh(),
  favorite: () => handlers?.favorite(),
  add: () => handlers?.add(),
  addAll: () => handlers?.addAll(),
  chooseAnchor: (bvid: string) => handlers?.chooseAnchor(bvid),
  scroll: (event: Event) => handlers?.scroll(event),
};
function installCollectionCallbacks(next: typeof handlers): void { handlers = next; }
export { collectionCallbacks, installCollectionCallbacks };
