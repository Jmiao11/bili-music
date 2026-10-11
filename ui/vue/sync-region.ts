import { h, render } from "vue";
import type { Component } from "vue";

const hosts = new WeakSet<Element>();

function createSyncRegion<P extends Record<string, unknown>>(host: Element, Component: Component<P>) {
  if (hosts.has(host)) throw new Error("Vue region already owns this host");
  if (host.childNodes.length) throw new Error("Vue region host must be empty");
  hosts.add(host);
  let disposed = false;
  let rendered = false;
  return {
    update(props: P): void {
      if (disposed) throw new Error("Vue region is unmounted");
      rendered = true;
      render(h(Component, props), host);
    },
    unmount(): void {
      if (disposed) return;
      disposed = true;
      try { if (rendered) render(null, host); }
      finally { hosts.delete(host); }
    },
  };
}

export { createSyncRegion };
