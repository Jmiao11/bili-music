// Only the public API used by the DOM smoke test; matches jsdom 26.1.0 lib/api.js.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string);
    readonly window: {
      document: Document;
      Node: typeof Node;
      Element: typeof Element;
      HTMLElement: typeof HTMLElement;
      SVGElement: typeof SVGElement;
      close(): void;
    };
  }
}
