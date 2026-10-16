import type { createMediaAdapter } from "../../platform/media-adapter.ts";

type PlaybackCommandPorts = {
  session(): { pendingResume: unknown; resumeInProgress: boolean };
  resume(): unknown;
  shuffle(): boolean;
  retreat(): boolean;
  advance(): boolean;
  previous(): unknown;
  next(): unknown;
  clearResume(): void;
  clearNotice(): void;
  media(): ReturnType<typeof createMediaAdapter>;
  observe(): { paused: boolean; duration: number; currentTime: number };
  setSeeking(value: boolean): void;
  syncPosition(): void;
  diagnostic(kind: string, message: string): void;
  status(message: string): void;
};

function createPlaybackCommands(ports: PlaybackCommandPorts) {
  const hasPendingResume = () => !!ports.session().pendingResume || ports.session().resumeInProgress;
  return {
    hasPendingResume,
    async togglePlayPause() {
      if (hasPendingResume()) { ports.resume(); return; }
      const media = ports.media();
      if (!media.getCurrentSource()) {
        ports.diagnostic("play-pause-button", "no source");
        ports.status("请先从队列中选择一首歌曲。");
        return;
      }
      if (media.getObservation().paused) {
        ports.diagnostic("play-pause-button", "play");
        try { await media.play(); }
        catch { ports.status("音频暂时无法播放，请稍后重试。"); }
      } else {
        ports.diagnostic("play-pause-button", "pause");
        media.pause();
      }
    },
    previous() {
      if (!ports.shuffle() && ports.retreat()) { ports.clearResume(); ports.clearNotice(); }
      else ports.previous();
    },
    next() {
      if (ports.advance()) { ports.clearResume(); ports.clearNotice(); }
      else ports.next();
    },
    seekSlider(time: number) {
      if (Number.isFinite(ports.observe().duration)) ports.media().setCurrentTime(time);
      ports.setSeeking(false);
    },
    seekTo(time: number | undefined) {
      const media = ports.observe();
      if (!Number.isFinite(media.duration) || media.duration <= 0 || time == null) return;
      ports.media().setCurrentTime(time); ports.syncPosition();
    },
    seekBy(direction: number, offset: number | undefined) {
      const media = ports.observe();
      if (!Number.isFinite(media.duration) || media.duration <= 0) return;
      const time = direction < 0 ? Math.max(0, media.currentTime - (offset || 10)) : Math.min(media.duration, media.currentTime + (offset || 10));
      ports.media().setCurrentTime(time); ports.syncPosition();
    },
  };
}

export { createPlaybackCommands };
