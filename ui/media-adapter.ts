type MediaTarget = {
  src: string;
  currentTime: number;
  volume: number;
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
    subscribe(type: string, listener: (event: Event) => void) {
      media.addEventListener(type, listener);
      return () => media.removeEventListener(type, listener);
    },
  };
}

export { createMediaAdapter };
