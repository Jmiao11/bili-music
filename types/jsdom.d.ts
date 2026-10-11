// Public APIs used by DOM tests; matches jsdom 26.1.0 lib/api.js.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    readonly window: Window & {
      document: Document;
      Node: typeof Node;
      Element: typeof Element;
      HTMLElement: typeof HTMLElement;
      SVGElement: typeof SVGElement;
      HTMLMediaElement: typeof HTMLMediaElement;
      Event: typeof Event;
      EventTarget: typeof EventTarget;
      KeyboardEvent: typeof KeyboardEvent;
      MouseEvent: typeof MouseEvent;
      close(): void;
    };
  }
}
