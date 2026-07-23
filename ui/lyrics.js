(() => {
  "use strict";

  const container = document.querySelector(".immersive-lyrics");
  const linesElement = document.querySelector("#lyrics-lines");
  const audio = document.querySelector("#audio");
  const invoke = window.__TAURI__?.core?.invoke;
  const timestampPattern = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  let lines = [];
  let lineElements = [];
  let lastActiveIndex = -1;

  function parseLrc(text) {
    if (typeof text !== "string") return [];

    const parsed = [];
    for (const sourceLine of text.split(/\r?\n/)) {
      const timestamps = [...sourceLine.matchAll(timestampPattern)];
      if (!timestamps.length) continue;

      const text = sourceLine.replace(timestampPattern, "").trim();
      if (!text) continue;

      for (const match of timestamps) {
        parsed.push({
          time:
            Number(match[1]) * 60 +
            Number(match[2]) +
            Number(`0.${match[3] ?? "0"}`),
          text,
        });
      }
    }
    return parsed.sort((left, right) => left.time - right.time);
  }

  function showPlaceholder() {
    lines = [];
    lineElements = [];
    lastActiveIndex = -1;
    linesElement?.replaceChildren();
    container?.classList.remove("has-lyrics");
  }

  function render(nextLines) {
    if (!container || !linesElement || !nextLines.length) {
      showPlaceholder();
      return;
    }

    const fragment = document.createDocumentFragment();
    lineElements = nextLines.map((line, index) => {
      const element = document.createElement("p");
      element.className = "lyrics-line";
      element.dataset.index = String(index);
      element.textContent = line.text;
      fragment.append(element);
      return element;
    });
    lines = nextLines;
    lastActiveIndex = -1;
    linesElement.replaceChildren(fragment);
    linesElement.scrollTop = 0;
    container.classList.add("has-lyrics");
    updateActiveLine();
  }

  function activeIndexAt(time) {
    let low = 0;
    let high = lines.length - 1;
    let result = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (lines[middle].time <= time) {
        result = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return result;
  }

  function scrollActiveIntoCenter(scrollContainer, lineElement) {
    if (!scrollContainer || !lineElement) return;

    const target =
      lineElement.offsetTop -
      scrollContainer.clientHeight / 2 +
      lineElement.offsetHeight / 2;
    const top = Math.max(
      0,
      Math.min(
        target,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
      ),
    );
    scrollContainer.scrollTo?.({
      top,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
        ? "auto"
        : "smooth",
    });
  }

  function updateActiveLine() {
    if (!audio || !Number.isFinite(audio.currentTime)) return;

    const index = activeIndexAt(audio.currentTime);
    if (index === lastActiveIndex) return;

    lineElements[lastActiveIndex]?.classList.remove("is-active");
    lastActiveIndex = index;
    const activeLine = lineElements[index];
    if (!activeLine || !linesElement) return;

    activeLine.classList.add("is-active");
    scrollActiveIntoCenter(linesElement, activeLine);
  }

  audio?.addEventListener("timeupdate", updateActiveLine);

  window.BiliLyrics = {
    async loadBySongId(songId) {
      try {
        if (!invoke) throw new Error("Tauri invoke 不可用");
        const result = await invoke("get_lyrics_by_id", { songId });
        if (!result?.hasLyric || !result.lrc?.trim()) {
          console.warn("未找到歌词");
          showPlaceholder();
          return;
        }

        const parsed = parseLrc(result.lrc);
        if (!parsed.length) {
          console.warn("歌词中没有可显示的时间行");
          showPlaceholder();
          return;
        }
        render(parsed);
      } catch (error) {
        console.warn("歌词加载失败：", error);
        showPlaceholder();
      }
    },
    clear: showPlaceholder,
  };
})();
