let handlers: { open: () => void; close: () => void; retry: () => void; scroll: (event: Event) => void } | null = null;
const collectionCallbacks = {
  open: () => handlers?.open(),
  close: () => handlers?.close(),
  retry: () => handlers?.retry(),
  scroll: (event: Event) => handlers?.scroll(event),
};
function installCollectionCallbacks(next: typeof handlers): void { handlers = next; }
export { collectionCallbacks, installCollectionCallbacks };
