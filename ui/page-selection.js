function isPageDisabled(disabledPages, bvid, cid) {
  return disabledPages.get(String(bvid).toLowerCase())?.has(cid) ?? false;
}

function findEnabledPageIndex(pages, startIndex, direction, isDisabled) {
  for (let index = startIndex; index >= 0 && index < pages.length; index += direction) {
    if (!isDisabled(pages[index])) return index;
  }
  return -1;
}

function pickRandomEnabledPageIndex(pages, isDisabled, random) {
  const enabledIndexes = pages.flatMap((page, index) => isDisabled(page) ? [] : [index]);
  return enabledIndexes[Math.floor(random() * enabledIndexes.length)] ?? -1;
}

function buildRandomPageRound(pages, currentIndex, isDisabled) {
  return pages.flatMap((page, index) => index === currentIndex || isDisabled(page) ? [] : [index]);
}

function takeRandomPageFromRound(remaining, isDisabledIndex, random) {
  const available = remaining.filter((index) => !isDisabledIndex(index));
  if (available.length === 0) return { index: -1, remaining: [] };
  const picked = Math.floor(random() * available.length);
  return {
    index: available[picked],
    remaining: available.filter((_, index) => index !== picked),
  };
}

function normalizeShuffleCollectionPrefs(rawOrder, rawLimit) {
  return {
    order: rawOrder === "sequential" ? "sequential" : "random",
    limit: ["1", "3", "5", "10"].includes(rawLimit) ? Number(rawLimit) : 0,
  };
}


export { buildRandomPageRound, findEnabledPageIndex, isPageDisabled, normalizeShuffleCollectionPrefs, pickRandomEnabledPageIndex, takeRandomPageFromRound };
