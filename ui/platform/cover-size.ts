import { coverTier } from "../features/library/cover-art.ts";

// Hidden views have no layout box. Their images are lazy and the tier is measured again when shown.
function measureCoverTier(box: HTMLElement, nominalSide: number): number {
  return coverTier(box.getBoundingClientRect().width || nominalSide, window.devicePixelRatio);
}

export { measureCoverTier };
