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
  const manualApplyButton = document.querySelector("#lyrics-manual-apply");
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

  function resetMatchUi() {
    if (matchElement) matchElement.hidden = true;
    if (matchHintElement) matchHintElement.textContent = "";
    if (candidatesElement) {
      candidatesElement.hidden = true;
      candidatesElement.replaceChildren();
    }
    if (manualRowElement) manualRowElement.hidden = true;
    if (manualInputElement) manualInputElement.value = "";
  }

  function showMatchActions(message) {
    if (matchElement) matchElement.hidden = false;
    if (matchHintElement) matchHintElement.textContent = message;
    if (candidatesElement) {
      candidatesElement.hidden = true;
      candidatesElement.replaceChildren();
    }
    if (manualRowElement) manualRowElement.hidden = true;
  }

  function showNoLyrics(message) {
    setPlaceholder(message);
    showMatchActions("可手动指定 QQ 音乐歌曲 id。");
  }

  function candidateDetails(scored) {
    const candidate = scored?.candidate ?? {};
    return {
      songId: String(candidate.songId ?? candidate.song_id ?? "").trim(),
      name: String(candidate.name ?? "").trim(),
      singer: String(candidate.singer ?? "").trim(),
    };
  }

  function showCandidates(result) {
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
    if (matchHintElement) {
      matchHintElement.textContent = usedKeyword
        ? `“${usedKeyword}”有多个可能结果`
        : "请选择匹配的歌词版本";
    }

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
      if (matchHintElement) {
        matchHintElement.textContent = "可手动指定 QQ 音乐歌曲 id。";
      }
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

  async function applyManualSongId() {
    const songId = manualInputElement?.value.trim() ?? "";
    if (!songId) {
      if (matchHintElement) {
        matchHintElement.textContent = "请输入 QQ 音乐歌曲 id。";
      }
      manualInputElement?.focus();
      return;
    }
    await bindSong({ songId, name: songId, singer: "" });
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
    manualRowElement.hidden = !manualRowElement.hidden;
    if (!manualRowElement.hidden) manualInputElement?.focus();
  });
  matchRematchButton?.addEventListener("click", () => {
    void rematchCurrentTrack();
  });
  manualApplyButton?.addEventListener("click", () => {
    void applyManualSongId();
  });
  manualInputElement?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void applyManualSongId();
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
