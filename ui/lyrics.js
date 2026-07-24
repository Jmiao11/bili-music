(() => {
  "use strict";

  const container = document.querySelector(".immersive-lyrics");
  const linesElement = document.querySelector("#lyrics-lines");
  const offsetMinusButton = document.querySelector("#lyrics-offset-minus");
  const offsetValueElement = document.querySelector("#lyrics-offset-value");
  const offsetPlusButton = document.querySelector("#lyrics-offset-plus");
  const modeToggleButton = document.querySelector("#lyrics-mode-toggle");
  const audio = document.querySelector("#audio");
  const invoke = window.__TAURI__?.core?.invoke;
  const timestampPattern = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  let lines = [];
  let lineElements = [];
  let lastActiveIndex = -1;
  let currentOffsetMs = 0;
  let currentBvid = "";
  let currentCid = 0;
  let displayMode = "synced";
  let offsetSaveTimer = 0;

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

  function updateOffsetValue() {
    if (!offsetValueElement) return;
    const seconds = currentOffsetMs / 1000;
    offsetValueElement.textContent = `${seconds > 0 ? "+" : ""}${seconds.toFixed(1)}s`;
  }

  function updateModeUi() {
    const isFull = displayMode === "full";
    linesElement?.classList.toggle("mode-full", isFull);
    if (modeToggleButton) {
      modeToggleButton.textContent = isFull ? "同步" : "全文";
    }
  }

  function clampOffset(offsetMs) {
    return Math.max(-30000, Math.min(30000, offsetMs));
  }

  function scheduleOffsetSave() {
    if (!invoke || !currentBvid || currentCid <= 0) return;

    const bvid = currentBvid;
    const cid = currentCid;
    const offsetMs = currentOffsetMs;
    window.clearTimeout(offsetSaveTimer);
    offsetSaveTimer = window.setTimeout(() => {
      offsetSaveTimer = 0;
      invoke("set_lyrics_offset", { bvid, cid, offsetMs }).catch((error) => {
        console.warn("歌词偏移保存失败：", error);
      });
    }, 400);
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
    if (
      displayMode !== "synced" ||
      !audio ||
      !Number.isFinite(audio.currentTime)
    ) {
      return;
    }

    const effective = audio.currentTime - currentOffsetMs / 1000;
    const index = activeIndexAt(effective);
    if (index === lastActiveIndex) return;

    lineElements[lastActiveIndex]?.classList.remove("is-active");
    lastActiveIndex = index;
    const activeLine = lineElements[index];
    if (!activeLine || !linesElement) return;

    activeLine.classList.add("is-active");
    scrollActiveIntoCenter(linesElement, activeLine);
  }

  function adjustOffset(deltaMs) {
    currentOffsetMs = clampOffset(currentOffsetMs + deltaMs);
    updateOffsetValue();
    updateActiveLine();
    scheduleOffsetSave();
  }

  function toggleDisplayMode() {
    displayMode = displayMode === "synced" ? "full" : "synced";
    updateModeUi();
    if (displayMode === "full") {
      lineElements.forEach((element) =>
        element.classList.remove("is-active"),
      );
      lastActiveIndex = -1;
      return;
    }
    updateActiveLine();
  }

  audio?.addEventListener("timeupdate", updateActiveLine);
  offsetMinusButton?.addEventListener("click", () => adjustOffset(-500));
  offsetPlusButton?.addEventListener("click", () => adjustOffset(500));
  modeToggleButton?.addEventListener("click", toggleDisplayMode);

  window.BiliLyrics = {
    async loadBySongId(songId, context) {
      currentOffsetMs = 0;
      currentBvid = "";
      currentCid = 0;
      displayMode = "synced";
      updateOffsetValue();
      updateModeUi();

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

        const bvid =
          typeof context?.bvid === "string" ? context.bvid.trim() : "";
        const cid = Number(context?.cid);
        if (bvid && Number.isSafeInteger(cid) && cid > 0) {
          currentBvid = bvid;
          currentCid = cid;
          try {
            currentOffsetMs = clampOffset(
              Number(await invoke("get_lyrics_offset", { bvid, cid })) || 0,
            );
          } catch (error) {
            currentOffsetMs = 0;
            console.warn("歌词偏移读取失败：", error);
          }
          updateOffsetValue();
          updateActiveLine();
        }
      } catch (error) {
        console.warn("歌词加载失败：", error);
        showPlaceholder();
      }
    },
    clear: showPlaceholder,
  };
})();
