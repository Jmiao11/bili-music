interface PlaybackDiagEntry {
  timestamp: string;
  category: string;
  message: string;
  paused: boolean;
  currentTime: number;
  readyState: number;
  networkState: number;
  currentSrcTail: string;
}

// main.js:226-250; dispatched at main.js:332.
interface CurrentTrackDetail {
  bvid: string;
  title: string;
  uploader: string;
  thumbnailUrl: string;
  durationSeconds: number;
  hasCurrent: boolean;
}

interface Window {
  // main.js:173-190; appearance.js:448, mini-player-host.js:97.
  __playbackDiagLog: PlaybackDiagEntry[];
  recordPlaybackDiag(category: string, message: string): void;
  // lyrics.js:650-704.
  BiliLyrics?: {
    loadBySongId(songId: string, context?: { bvid?: unknown; cid?: unknown }): Promise<void>;
    clear(): void;
  };
  // mascot.js:353-373; appearance.js:649-701.
  BiliMascot?: {
    list(): { id: string; name: string; svg: string }[];
    getActive(): string;
    setActive(id: string): string;
  };
}

interface WindowEventMap {
  "bilibili-music-trackchange": CustomEvent<CurrentTrackDetail>;
  // main.js:1164 -> lyrics.js:607, main.js:1624.
  "bili-track-changed": CustomEvent<{ bvid: string; cid: number }>;
  // appearance.js:811 -> main.js:1900.
  "bilibili-music-viewchange": CustomEvent<{ view: string }>;
  // library-ui.js:439,447 -> mini-player-host.js:171.
  "bilibili-music-favorite-change": CustomEvent<
    { bvid: string; title: string } & ({ favorited: boolean } | { failed: true })
  >;
  // library-ui.js:443 -> mascot.js:424.
  "bilibili-music-favorite": CustomEvent<{ bvid: string; title: string }>;
  // These are Event, not CustomEvent: main.js:345,367,1733; appearance.js:1049.
  "bilibili-music-notice-change": Event;
  "bilibili-music-audio-cache-updated": Event;
  "ai-config-updated": Event;
}
