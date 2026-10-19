import { setTimeout } from "node:timers/promises";

// Vue timestamps listeners with Date.now(); synthetic input needs a later real event turn.
async function nextDomEventTurn() {
  const mountedAt = Date.now();
  do { await setTimeout(1); } while (Date.now() <= mountedAt);
}

export { nextDomEventTurn };
