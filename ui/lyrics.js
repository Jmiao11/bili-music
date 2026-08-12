(() => {
  "use strict";

  const container = document.querySelector(".immersive-lyrics");
  const linesElement = document.querySelector("#lyrics-lines");
  const offsetMinusButton = document.querySelector("#lyrics-offset-minus");
  const offsetValueElement = document.querySelector("#lyrics-offset-value");
  const offsetPlusButton = document.querySelector("#lyrics-offset-plus");
  const modeToggleButton = document.querySelector("#lyrics-mode-toggle");
  const placeholderElement = document.querySelector("#lyrics-placeholder");
  const matchElement = document.querySelector("#lyrics-match");
  const matchHintElement = document.querySelector("#lyrics-match-hint");
  const candidatesElement = document.querySelector("#lyrics-candidates");
  const matchManualButton = document.querySelector("#lyrics-match-manual");
  const matchRematchButton = document.querySelector("#lyrics-match-rematch");
  const manualRowElement = document.querySelector("#lyrics-manual-row");
  const manualInputElement = document.querySelector("#lyrics-manual-input");
  const manualSearchButton = document.querySelector("#lyrics-manual-search");
  const manualResultsElement = document.querySelector(
    "#lyrics-manual-results",
  );
  const immersiveTitleElement = document.querySelector("#immersive-title");
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
  let lyricsRequestVersion = 0;
  let lastTrackKey = "";
  let matchIdleTimer = 0;
  let matchCanIdle = false;

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

  function setPlaceholder(message) {
    if (placeholderElement) placeholderElement.textContent = message;
    showPlaceholder();
  }

  function setMatchHint(message) {
    if (!matchHintElement) return;
    matchHintElement.textContent = message;
    matchHintElement.hidden = !message;
  }

  function keepMatchVisible() {
    window.clearTimeout(matchIdleTimer);
    matchIdleTimer = 0;
    matchElement?.classList.remove("is-idle");
  }

  function disableMatchIdle() {
    matchCanIdle = false;
    keepMatchVisible();
  }

  function isMatchInteractionActive() {
    return Boolean(
      matchElement?.matches(":hover") ||
        matchElement?.contains(document.activeElement),
    );
  }

  function scheduleMatchIdle(delayMs) {
    keepMatchVisible();
    if (
      !matchElement ||
      !matchCanIdle ||
      matchElement.hidden ||
      !manualRowElement?.hidden ||
      isMatchInteractionActive()
    ) {
      return;
    }
    matchIdleTimer = window.setTimeout(() => {
      matchIdleTimer = 0;
      if (
        matchElement &&
        matchCanIdle &&
        !matchElement.hidden &&
        manualRowElement?.hidden &&
        !isMatchInteractionActive()
      ) {
        matchElement.classList.add("is-idle");
      }
    }, delayMs);
  }

  function resetManualSearchUi() {
    if (manualRowElement) manualRowElement.hidden = true;
    if (manualInputElement) manualInputElement.value = "";
    if (manualResultsElement) {
      manualResultsElement.hidden = true;
      manualResultsElement.replaceChildren();
    }
    if (manualSearchButton) {
      manualSearchButton.disabled = false;
      manualSearchButton.textContent = "搜索";
    }
  }

  function resetMatchUi() {
    disableMatchIdle();
    if (matchElement) matchElement.hidden = true;
    setMatchHint("");
    if (candidatesElement) {
      candidatesElement.hidden = true;
      candidatesElement.replaceChildren();
    }
    resetManualSearchUi();
  }

  function showMatchActions(message) {
    if (matchElement) matchElement.hidden = false;
    setMatchHint(message);
    if (candidatesElement) {
      candidatesElement.hidden = true;
      candidatesElement.replaceChildren();
    }
    resetManualSearchUi();
  }

  function showNoLyrics(message) {
    disableMatchIdle();
    setPlaceholder(message);
    showMatchActions("");
  }

  function candidateDetails(value) {
    const candidate = value?.candidate ?? value ?? {};
    return {
      songId: String(candidate.songId ?? candidate.song_id ?? "").trim(),
      name: String(candidate.name ?? "").trim(),
      singer: String(candidate.singer ?? "").trim(),
      duration: Number(candidate.duration) || 0,
    };
  }

  function showCandidates(result) {
    disableMatchIdle();
    setPlaceholder("未自动匹配到歌词");
    const candidates = Array.isArray(result?.candidates)
      ? result.candidates
      : [];
    if (!matchElement || !candidatesElement || !candidates.length) {
      showNoLyrics("未自动匹配到歌词");
      return;
    }

    matchElement.hidden = false;
    candidatesElement.hidden = false;
    const usedKeyword = String(
      result?.usedKeyword ?? result?.used_keyword ?? "",
    ).trim();
    setMatchHint(
      usedKeyword
        ? `“${usedKeyword}”有多个可能结果`
        : "请选择匹配的歌词版本",
    );

    const fragment = document.createDocumentFragment();
    for (const scored of candidates) {
      const candidate = candidateDetails(scored);
      if (!candidate.songId || !candidate.name) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lyrics-candidate";
      button.textContent = candidate.singer
        ? `${candidate.name} - ${candidate.singer}`
        : candidate.name;
      button.addEventListener("click", () => {
        void bindSong(candidate);
      });
      fragment.append(button);
    }

    const rejectButton = document.createElement("button");
    rejectButton.type = "button";
    rejectButton.className = "lyrics-candidate lyrics-candidate-none";
    rejectButton.textContent = "都不是";
    rejectButton.addEventListener("click", () => {
      candidatesElement.hidden = true;
      candidatesElement.replaceChildren();
      setMatchHint("");
      setPlaceholder("未自动匹配到歌词");
    });
    fragment.append(rejectButton);
    candidatesElement.replaceChildren(fragment);
  }

  function showResolvedActions(result) {
    const songName = String(
      result?.songName ?? result?.song_name ?? "",
    ).trim();
    const singer = String(result?.singer ?? "").trim();
    showMatchActions(
      songName
        ? `已匹配：${songName}${singer ? ` - ${singer}` : ""}`
        : "歌词已匹配",
    );
    matchCanIdle = true;
    scheduleMatchIdle(3000);
  }

  function applyOutcome(result) {
    const status = String(result?.status ?? "");
    if (status === "bound" || status === "auto") {
      currentOffsetMs = clampOffset(
        Number(result?.offsetMs ?? result?.offset_ms) || 0,
      );
      updateOffsetValue();
      const lyric = result?.lyrics;
      const hasLyric = lyric?.hasLyric ?? lyric?.has_lyric;
      if (hasLyric && lyric?.lrc?.trim()) {
        const parsed = parseLrc(lyric.lrc);
        if (parsed.length) {
          render(parsed);
          updateActiveLine();
          showResolvedActions(result);
          return;
        }
        console.warn("歌词中没有可显示的时间行");
      }
      showNoLyrics("暂无歌词");
      return;
    }
    if (status === "candidates") {
      showCandidates(result);
      return;
    }
    if (status === "skip") {
      showNoLyrics("纯音乐或合集 · 未自动匹配");
      return;
    }
    if (status !== "none") {
      console.warn("未知歌词匹配状态：", status);
    }
    showNoLyrics("暂无歌词");
  }

  function isCurrentRequest(version, bvid, cid) {
    return (
      version === lyricsRequestVersion &&
      bvid === currentBvid &&
      cid === currentCid
    );
  }

  async function resolveAt(version, bvid, cid, force = false) {
    if (!invoke) throw new Error("Tauri invoke 不可用");
    const result = await invoke("resolve_lyrics", { bvid, cid, force });
    if (!isCurrentRequest(version, bvid, cid)) return;
    applyOutcome(result);
  }

  async function handleTrackChanged(event) {
    const bvid =
      typeof event?.detail?.bvid === "string"
        ? event.detail.bvid.trim()
        : "";
    const cid = Number(event?.detail?.cid);
    if (!bvid || !Number.isSafeInteger(cid) || cid <= 0) return;

    const trackKey = `${bvid}:${cid}`;
    if (trackKey === lastTrackKey) return;
    lastTrackKey = trackKey;
    const version = ++lyricsRequestVersion;
    currentBvid = bvid;
    currentCid = cid;
    currentOffsetMs = 0;
    updateOffsetValue();
    setPlaceholder("正在匹配歌词…");
    resetMatchUi();

    try {
      await resolveAt(version, bvid, cid);
    } catch (error) {
      if (!isCurrentRequest(version, bvid, cid)) return;
      console.warn("歌词自动匹配失败：", error);
      showNoLyrics("暂无歌词");
    }
  }

  async function bindSong(candidate) {
    const bvid = currentBvid;
    const cid = currentCid;
    if (!invoke || !bvid || cid <= 0 || !candidate.songId) return;

    const version = ++lyricsRequestVersion;
    setPlaceholder("正在加载歌词…");
    resetMatchUi();
    try {
      await invoke("set_lyrics_binding", {
        bvid,
        cid,
        songId: candidate.songId,
        songName: candidate.name || candidate.songId,
        singer: candidate.singer || "",
      });
      if (!isCurrentRequest(version, bvid, cid)) return;
      await resolveAt(version, bvid, cid);
    } catch (error) {
      if (!isCurrentRequest(version, bvid, cid)) return;
      console.warn("歌词绑定失败：", error);
      showNoLyrics("暂无歌词");
    }
  }

  function showManualMessage(message) {
    if (!manualResultsElement) return;
    const element = document.createElement("p");
    element.className = "lyrics-manual-empty";
    element.textContent = message;
    manualResultsElement.replaceChildren(element);
    manualResultsElement.hidden = false;
  }

  function formatDuration(duration) {
    const seconds = Math.max(0, Math.floor(Number(duration) || 0));
    if (!seconds) return "";
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function renderManualResults(result) {
    if (!manualResultsElement) return;
    const candidates = (Array.isArray(result) ? result : [])
      .map(candidateDetails)
      .filter((candidate) => candidate.songId && candidate.name)
      .slice(0, 10);
    if (!candidates.length) {
      showManualMessage("没有找到相关歌曲");
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const candidate of candidates) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lyrics-manual-result";

      const name = document.createElement("span");
      name.textContent = candidate.name;
      button.append(name);

      const duration = formatDuration(candidate.duration);
      const details = [
        candidate.singer ? `- ${candidate.singer}` : "",
        duration ? `· ${duration}` : "",
      ].filter(Boolean);
      if (details.length) {
        const meta = document.createElement("span");
        meta.className = "lyrics-manual-result-meta";
        meta.textContent = details.join(" ");
        button.append(meta);
      }

      button.addEventListener("click", () => {
        if (!currentBvid || currentCid <= 0) {
          showManualMessage("当前没有可绑定的播放曲目");
          return;
        }
        void bindSong(candidate);
      });
      fragment.append(button);
    }
    manualResultsElement.replaceChildren(fragment);
    manualResultsElement.hidden = false;
  }

  async function searchManualSongs() {
    if (manualSearchButton?.disabled) return;
    const keyword = manualInputElement?.value.trim() ?? "";
    if (!keyword) {
      showManualMessage("请输入歌名或歌手");
      manualInputElement?.focus();
      return;
    }
    if (!invoke) {
      console.warn("歌词手动搜索失败：Tauri invoke 不可用");
      showManualMessage("搜索失败，请稍后重试");
      return;
    }

    const version = lyricsRequestVersion;
    const bvid = currentBvid;
    const cid = currentCid;
    if (manualSearchButton) {
      manualSearchButton.disabled = true;
      manualSearchButton.textContent = "搜索中…";
    }
    if (manualResultsElement) {
      manualResultsElement.hidden = true;
      manualResultsElement.replaceChildren();
    }
    try {
      const result = await invoke("search_lyrics_songs", { keyword });
      if (!isCurrentRequest(version, bvid, cid)) return;
      renderManualResults(result);
    } catch (error) {
      if (!isCurrentRequest(version, bvid, cid)) return;
      console.warn("歌词手动搜索失败：", error);
      showManualMessage("搜索失败，请稍后重试");
    } finally {
      if (isCurrentRequest(version, bvid, cid) && manualSearchButton) {
        manualSearchButton.disabled = false;
        manualSearchButton.textContent = "搜索";
      }
    }
  }

  async function rematchCurrentTrack() {
    const bvid = currentBvid;
    const cid = currentCid;
    if (!invoke || !bvid || cid <= 0) return;

    const version = ++lyricsRequestVersion;
    setPlaceholder("正在重新匹配…");
    resetMatchUi();
    try {
      await invoke("clear_lyrics_binding", { bvid, cid });
      if (!isCurrentRequest(version, bvid, cid)) return;
      await resolveAt(version, bvid, cid, true);
    } catch (error) {
      if (!isCurrentRequest(version, bvid, cid)) return;
      console.warn("歌词重新匹配失败：", error);
      showNoLyrics("暂无歌词");
    }
  }

  audio?.addEventListener("timeupdate", updateActiveLine);
  offsetMinusButton?.addEventListener("click", () => adjustOffset(-500));
  offsetPlusButton?.addEventListener("click", () => adjustOffset(500));
  modeToggleButton?.addEventListener("click", toggleDisplayMode);
  window.addEventListener("bili-track-changed", (event) => {
    void handleTrackChanged(event);
  });
  matchManualButton?.addEventListener("click", () => {
    if (!manualRowElement) return;
    keepMatchVisible();
    if (!manualRowElement.hidden) {
      resetManualSearchUi();
      return;
    }
    manualRowElement.hidden = false;
    if (manualInputElement) {
      manualInputElement.value = String(
        immersiveTitleElement?.textContent ?? "",
      )
        .replace(/【[^】]*】|\[[^\]]*\]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      manualInputElement.focus();
      manualInputElement.select();
    }
  });
  matchRematchButton?.addEventListener("click", () => {
    void rematchCurrentTrack();
  });
  manualSearchButton?.addEventListener("click", () => {
    void searchManualSongs();
  });
  manualInputElement?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void searchManualSongs();
  });
  matchElement?.addEventListener("mouseenter", keepMatchVisible);
  matchElement?.addEventListener("mouseleave", () => {
    scheduleMatchIdle(1500);
  });
  matchElement?.addEventListener("focusin", keepMatchVisible);
  matchElement?.addEventListener("focusout", (event) => {
    if (matchElement.contains(event.relatedTarget)) return;
    scheduleMatchIdle(1500);
  });

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
