import { installPlaybackCallbacks } from "../playback/root-playback.ts";
import { getApplicationStore } from "../home/home.ts";
function initializeLyrics() {
  "use strict";

  type LyricsLine = { time: number; text: string };
  type LyricsCandidateInput = Partial<CommandContract.Candidate> & { songId?: string };
  type LyricsOutcome = CommandContract.ResolveOutcome & { usedKeyword?: string; songName?: string; offsetMs?: number; lyrics: (CommandContract.Lyrics & { has_lyric?: boolean }) | null };

    const container = document.querySelector<HTMLElement>(".immersive-lyrics");
    const linesElement = document.querySelector<HTMLDivElement>("#lyrics-lines");
    const offsetMinusButton = document.querySelector<HTMLButtonElement>("#lyrics-offset-minus");
    const offsetValueElement = document.querySelector<HTMLSpanElement>("#lyrics-offset-value");
    const offsetPlusButton = document.querySelector<HTMLButtonElement>("#lyrics-offset-plus");
    const modeToggleButton = document.querySelector<HTMLButtonElement>("#lyrics-mode-toggle");
    const placeholderElement = document.querySelector<HTMLParagraphElement>("#lyrics-placeholder");
    const matchElement = document.querySelector<HTMLDivElement>("#lyrics-match");
    const matchHintElement = document.querySelector<HTMLParagraphElement>("#lyrics-match-hint");
    const candidatesElement = document.querySelector<HTMLDivElement>("#lyrics-candidates");
    const matchManualButton = document.querySelector<HTMLButtonElement>("#lyrics-match-manual");
    const matchRematchButton = document.querySelector<HTMLButtonElement>("#lyrics-match-rematch");
    const manualRowElement = document.querySelector<HTMLDivElement>("#lyrics-manual-row");
    const manualInputElement = document.querySelector<HTMLInputElement>("#lyrics-manual-input");
    const manualSearchButton = document.querySelector<HTMLButtonElement>("#lyrics-manual-search");
    const manualResultsElement = document.querySelector<HTMLDivElement>(
    "#lyrics-manual-results",
  );
    const immersiveTitleElement = document.querySelector<HTMLElement>("#immersive-title");
    const audio = document.querySelector<HTMLAudioElement>("#audio");
  const invoke = window.__TAURI__?.core?.invoke;
  const timestampPattern = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  let lines: LyricsLine[] = [];
  let lineElements: HTMLParagraphElement[] = [];
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
  const display = getApplicationStore().actions.lyricsDisplay;
  const manualDraft = { read: () => manualInputElement?.value ?? "", write: (value: string) => { if (manualInputElement) manualInputElement.value = value; } };

  function parseLrc(text: unknown) {
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
    display.clearLines();
  }

  function render(nextLines: LyricsLine[]) {
    if (!container || !linesElement || !nextLines.length) {
      showPlaceholder();
      return;
    }

    lines = nextLines;
    lastActiveIndex = -1;
    display.showLines(nextLines);
    lineElements = [...linesElement.querySelectorAll<HTMLParagraphElement>(".lyrics-line")];
    linesElement.scrollTop = 0;
    updateActiveLine();
  }

  function activeIndexAt(time: number) {
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
    display.setOffset(`${seconds > 0 ? "+" : ""}${seconds.toFixed(1)}s`);
  }

  function updateModeUi() {
    display.setMode(displayMode === "full");
  }

  function clampOffset(offsetMs: number) {
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

  function scrollActiveIntoCenter(scrollContainer: HTMLElement | null, lineElement: HTMLElement | null) {
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

    lastActiveIndex = index;
    display.setActive(index);
    const activeLine = lineElements[index];
    if (!activeLine || !linesElement) return;

    scrollActiveIntoCenter(linesElement, activeLine);
  }

  function adjustOffset(deltaMs: number) {
    currentOffsetMs = clampOffset(currentOffsetMs + deltaMs);
    updateOffsetValue();
    updateActiveLine();
    scheduleOffsetSave();
  }

  function toggleDisplayMode() {
    displayMode = displayMode === "synced" ? "full" : "synced";
    updateModeUi();
    if (displayMode === "full") {
      display.setActive(-1);
      lastActiveIndex = -1;
      return;
    }
    updateActiveLine();
  }

  function setPlaceholder(message: string) {
    if (placeholderElement) display.setPlaceholder(message);
    showPlaceholder();
  }

  function setMatchHint(message: string) {
    if (!matchHintElement) return;
    display.setHint(message);
  }

  function keepMatchVisible() {
    window.clearTimeout(matchIdleTimer);
    matchIdleTimer = 0;
    display.setIdle(false);
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

  function scheduleMatchIdle(delayMs: number) {
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
        display.setIdle(true);
      }
    }, delayMs);
  }

  function resetManualSearchUi() {
    if (manualRowElement) display.setManualHidden(true);
    manualDraft.write("");
    if (manualResultsElement) {
      display.clearResults();
    }
    if (manualSearchButton) {
      display.setManualBusy(false);
    }
  }

  function resetMatchUi() {
    disableMatchIdle();
    if (matchElement) display.setMatchHidden(true);
    setMatchHint("");
    if (candidatesElement) {
      display.clearCandidates();
    }
    resetManualSearchUi();
  }

  function showMatchActions(message: string) {
    if (matchElement) display.setMatchHidden(false);
    setMatchHint(message);
    if (candidatesElement) {
      display.clearCandidates();
    }
    resetManualSearchUi();
  }

  function showNoLyrics(message: string) {
    disableMatchIdle();
    setPlaceholder(message);
    showMatchActions("");
  }

  function candidateDetails(value: LyricsCandidateInput & { candidate?: LyricsCandidateInput }) {
    const candidate: LyricsCandidateInput = value?.candidate ?? value ?? {};
    return {
      songId: String(candidate.songId ?? candidate.song_id ?? "").trim(),
      name: String(candidate.name ?? "").trim(),
      singer: String(candidate.singer ?? "").trim(),
      duration: Number(candidate.duration) || 0,
    };
  }

  function showCandidates(result: LyricsOutcome | null | undefined) {
    disableMatchIdle();
    setPlaceholder("未自动匹配到歌词");
    const candidates = Array.isArray(result?.candidates)
      ? result.candidates
      : [];
    if (!matchElement || !candidatesElement || !candidates.length) {
      showNoLyrics("未自动匹配到歌词");
      return;
    }

    display.setMatchHidden(false);
    const usedKeyword = String(
      result?.usedKeyword ?? result?.used_keyword ?? "",
    ).trim();
    setMatchHint(
      usedKeyword
        ? `“${usedKeyword}”有多个可能结果`
        : "请选择匹配的歌词版本",
    );

    display.showCandidates(candidates.map(candidateDetails).filter(candidate => candidate.songId && candidate.name));
  }

  function showResolvedActions(result: LyricsOutcome | null | undefined) {
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

  function applyOutcome(result: LyricsOutcome | null | undefined) {
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

  function isCurrentRequest(version: number, bvid: string, cid: number) {
    return (
      version === lyricsRequestVersion &&
      bvid === currentBvid &&
      cid === currentCid
    );
  }

  async function resolveAt(version: number, bvid: string, cid: number, force = false) {
    if (!invoke) throw new Error("Tauri invoke 不可用");
    const result = await invoke("resolve_lyrics", { bvid, cid, force });
    if (!isCurrentRequest(version, bvid, cid)) return;
    applyOutcome(result);
  }

  async function handleTrackChanged(event: WindowEventMap["bili-track-changed"]) {
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

  async function bindSong(candidate: ReturnType<typeof candidateDetails>) {
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

  function showManualMessage(message: string) {
    if (!manualResultsElement) return;
    display.showResultMessage(message);
  }

  function formatDuration(duration: number) {
    const seconds = Math.max(0, Math.floor(Number(duration) || 0));
    if (!seconds) return "";
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function renderManualResults(result: CommandMap["search_lyrics_songs"]["result"] | null | undefined) {
    if (!manualResultsElement) return;
    const candidates = (Array.isArray(result) ? result : [])
      .map(candidateDetails)
      .filter((candidate) => candidate.songId && candidate.name)
      .slice(0, 10);
    if (!candidates.length) {
      showManualMessage("没有找到相关歌曲");
      return;
    }

    display.showResults(candidates.map(candidate => {
      const duration = formatDuration(candidate.duration);
      const details = [candidate.singer ? `- ${candidate.singer}` : "", duration ? `· ${duration}` : ""].filter(Boolean);
      return { ...candidate, metadata: details.join(" ") };
    }));
  }

  async function searchManualSongs() {
    if (manualSearchButton?.disabled) return;
    const keyword = manualDraft.read().trim();
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
      display.setManualBusy(true);
    }
    if (manualResultsElement) {
      display.clearResults();
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
        display.setManualBusy(false);
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

  installPlaybackCallbacks({
    bindLyrics: candidate => { void bindSong(candidate); },
    rejectLyrics: () => { display.clearCandidates(); setMatchHint(""); setPlaceholder("未自动匹配到歌词"); },
    bindManualLyrics: candidate => {
      if (!currentBvid || currentCid <= 0) { showManualMessage("当前没有可绑定的播放曲目"); return; }
      void bindSong(candidate);
    },
  });

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
    display.setManualHidden(false);
    if (manualInputElement) {
      manualDraft.write(String(
        immersiveTitleElement?.textContent ?? "",
      )
        .replace(/【[^】]*】|\[[^\]]*\]/g, " ")
        .replace(/\s+/g, " ")
        .trim());
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
    if (matchElement.contains((event.relatedTarget as Node | null))) return;
    scheduleMatchIdle(1500);
  });

  return {
    async loadBySongId(songId: string, context?: { bvid?: unknown; cid?: unknown }) {
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
}

export { initializeLyrics };
