let vueTrackRows: WeakSet<Element> | null = null;
function ownVueTrackRow(row: Element): void { (vueTrackRows ??= new WeakSet()).add(row); }
function releaseVueTrackRow(row: Element): void { vueTrackRows?.delete(row); }
function isVueTrackRow(row: Element | null | undefined): boolean { return !!row && (vueTrackRows?.has(row) ?? false); }
export { isVueTrackRow, ownVueTrackRow, releaseVueTrackRow };
