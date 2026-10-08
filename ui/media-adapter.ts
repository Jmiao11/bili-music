type MediaTarget = {
  src: string;
  currentTime: number;
  volume: number;
  duration?: number;
  paused?: boolean;
  ended?: boolean;
  playbackRate?: number;
  load(): void;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

function createMediaAdapter(media: MediaTarget) {
  return {
    getSource: () => media.src,
    setSource: (source: string) => { media.src = source; },
    load: () => media.load(),
    play: () => media.play(),
    pause: () => media.pause(),
    getCurrentTime: () => media.currentTime,
    setCurrentTime: (time: number) => { media.currentTime = time; },
    getVolume: () => media.volume,
    setVolume: (volume: number) => { media.volume = volume; },
    getObservation: () => ({ currentTime: media.currentTime, duration: media.duration ?? NaN, paused: media.paused ?? true, ended: media.ended ?? false, playbackRate: media.playbackRate ?? 1 }),
    subscribe(type: string, listener: (event: Event) => void) {
      media.addEventListener(type, listener);
      return () => media.removeEventListener(type, listener);
    },
  };
}

function createMediaSessionAdapter(session: MediaSession, metadata: (init: MediaMetadataInit) => MediaMetadata) {
  return {
    setTrack(track: { title: string; uploader: string; thumbnailUrl: string } | null) {
      session.metadata = track ? metadata({ title: track.title, artist: track.uploader,
        artwork: track.thumbnailUrl ? [{ src: track.thumbnailUrl, sizes: "512x512", type: "image/jpeg" }] : [] }) : null;
    },
    setPlaybackState: (state: MediaSessionPlaybackState) => { session.playbackState = state; },
    setPosition: (position: MediaPositionState) => { if (typeof session.setPositionState === "function") session.setPositionState(position); },
    setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler) => session.setActionHandler(action, handler),
  };
}

export { createMediaAdapter, createMediaSessionAdapter };
