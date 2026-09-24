const AUDIO_REACTIVE_FFT_SIZE = 1024;
const AUDIO_REACTIVE_FRAME_INTERVAL_MS = 1000 / 30;
const AUDIO_REACTIVE_REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const AUDIO_REACTIVE_SCALE_RANGE = 0.075;
const AUDIO_REACTIVE_BRIGHTNESS_RANGE = 0.075;
const AUDIO_REACTIVE_GLOW_RANGE_PX = 28;
const AUDIO_REACTIVE_GLOW_ALPHA_RANGE = 0.38;

function clampAudioReactiveUnit(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function averageAudioReactiveBand(data, sampleRate, fftSize, lowHz, highHz) {
  const binWidth = sampleRate / fftSize;
  const start = Math.max(1, Math.floor(lowHz / binWidth));
  const end = Math.min(data.length - 1, Math.ceil(highHz / binWidth));
  if (end < start) return 0;

  let total = 0;
  for (let index = start; index <= end; index += 1) {
    total += data[index];
  }
  const average = total / (end - start + 1) / 255;
  return clampAudioReactiveUnit((average - 0.08) * 1.35);
}

function smoothAudioReactiveValue(previous, next) {
  const factor = next > previous ? 0.68 : 0.18;
  return clampAudioReactiveUnit(previous + (next - previous) * factor);
}

function applyAudioReactiveVisual(target, frame) {
  if (!target?.style?.setProperty) return;
  const pulse = frame.active ? clampAudioReactiveUnit(frame.pulse) : 0;
  const glow = frame.active ? clampAudioReactiveUnit(frame.glow) : 0;
  target.style.setProperty("--audio-cover-scale", (1 + pulse * AUDIO_REACTIVE_SCALE_RANGE).toFixed(4));
  target.style.setProperty("--audio-cover-brightness", (1 + glow * AUDIO_REACTIVE_BRIGHTNESS_RANGE).toFixed(4));
  target.style.setProperty("--audio-cover-glow-size", `${(glow * AUDIO_REACTIVE_GLOW_RANGE_PX).toFixed(2)}px`);
  target.style.setProperty("--audio-cover-glow-alpha", (glow * AUDIO_REACTIVE_GLOW_ALPHA_RANGE).toFixed(4));
}

function createAudioReactiveController({
  audio,
  target,
  targets,
  document,
  window,
  AudioContextCtor = window?.AudioContext || window?.webkitAudioContext,
  matchMedia = window?.matchMedia?.bind(window),
  requestAnimationFrameFn = window?.requestAnimationFrame?.bind(window),
  cancelAnimationFrameFn = window?.cancelAnimationFrame?.bind(window),
  console,
}) {
  const visualTargets = (Array.isArray(targets) ? targets : [target])
    .filter((candidate) => candidate?.style?.setProperty);
  let started = false;
  let disposed = false;
  let warned = false;
  let context = null;
  let source = null;
  let analyser = null;
  let frequencyData = null;
  let outputConnected = false;
  let analyserConnected = false;
  let initialization = null;
  let animationFrame = null;
  let lastAnimationAt = Number.NEGATIVE_INFINITY;
  let sequence = 0;
  let smoothedPulse = 0;
  let smoothedGlow = 0;
  let lastFrame = { sequence, active: false, pulse: 0, glow: 0 };
  const reducedMotion = typeof matchMedia === "function"
    ? matchMedia(AUDIO_REACTIVE_REDUCED_MOTION_QUERY)
    : null;

  function warnOnce(message, error) {
    if (warned) return;
    warned = true;
    console?.warn?.(message, error);
  }

  function makeFrame(active, pulse, glow) {
    lastFrame = {
      sequence: ++sequence,
      active: Boolean(active),
      pulse: clampAudioReactiveUnit(pulse),
      glow: clampAudioReactiveUnit(glow),
    };
    for (const visualTarget of visualTargets) {
      applyAudioReactiveVisual(visualTarget, lastFrame);
    }
    return lastFrame;
  }

  function reset() {
    smoothedPulse = 0;
    smoothedGlow = 0;
    return makeFrame(false, 0, 0);
  }

  function motionAllowed() {
    return !reducedMotion?.matches;
  }

  async function ensureGraph() {
    if (disposed || !motionAllowed() || !AudioContextCtor) return false;
    if (analyserConnected && context?.state === "running") return true;
    if (initialization) return initialization;

    initialization = (async () => {
      try {
        context ??= new AudioContextCtor();
        if (context.state !== "running") {
          await context.resume();
        }
        if (context.state !== "running") return false;

        analyser ??= context.createAnalyser();
        analyser.fftSize = AUDIO_REACTIVE_FFT_SIZE;
        analyser.smoothingTimeConstant = 0.5;
        analyser.minDecibels = -75;
        analyser.maxDecibels = -20;

        if (!source) {
          source = context.createMediaElementSource(audio);
        }
        if (!outputConnected) {
          source.connect(context.destination);
          outputConnected = true;
        }
        if (!analyserConnected) {
          source.connect(analyser);
          analyserConnected = true;
        }
        frequencyData ??= new Uint8Array(analyser.frequencyBinCount);
        return true;
      } catch (error) {
        warnOnce("audio reactive analysis disabled:", error);
        return false;
      } finally {
        initialization = null;
      }
    })();

    return initialization;
  }

  function canSample() {
    return !disposed
      && motionAllowed()
      && analyserConnected
      && context?.state === "running"
      && !audio.paused
      && !audio.ended;
  }

  function sample() {
    if (!canSample()) {
      if (!audio.paused && context?.state !== "running") void ensureGraph();
      return lastFrame.active ? reset() : lastFrame;
    }

    analyser.getByteFrequencyData(frequencyData);
    const sampleRate = Number(context.sampleRate) || 48_000;
    const bass = averageAudioReactiveBand(frequencyData, sampleRate, analyser.fftSize, 40, 240);
    const mid = averageAudioReactiveBand(frequencyData, sampleRate, analyser.fftSize, 240, 2_000);
    const treble = averageAudioReactiveBand(frequencyData, sampleRate, analyser.fftSize, 2_000, 8_000);
    const rawPulse = clampAudioReactiveUnit(bass * 0.72 + mid * 0.28);
    const rawGlow = clampAudioReactiveUnit(bass * 0.25 + mid * 0.5 + treble * 0.25);
    smoothedPulse = smoothAudioReactiveValue(smoothedPulse, rawPulse);
    smoothedGlow = smoothAudioReactiveValue(smoothedGlow, rawGlow);
    return makeFrame(true, smoothedPulse, smoothedGlow);
  }

  function shouldAnimateMainWindow() {
    return started
      && !disposed
      && motionAllowed()
      && document?.visibilityState !== "hidden"
      && !audio.paused
      && !audio.ended
      && analyserConnected
      && context?.state === "running"
      && typeof requestAnimationFrameFn === "function";
  }

  function stopAnimationFrame() {
    if (animationFrame === null) return;
    cancelAnimationFrameFn?.(animationFrame);
    animationFrame = null;
  }

  function animate(timestamp) {
    animationFrame = null;
    if (!shouldAnimateMainWindow()) return;
    if (timestamp - lastAnimationAt >= AUDIO_REACTIVE_FRAME_INTERVAL_MS) {
      lastAnimationAt = timestamp;
      try {
        sample();
      } catch (error) {
        // A transient analyser failure must not terminate the animation loop.
        reset();
        warnOnce("audio reactive sample failed:", error);
      }
    }
    animationFrame = requestAnimationFrameFn(animate);
  }

  function updateAnimation() {
    if (!shouldAnimateMainWindow()) {
      stopAnimationFrame();
      return;
    }
    if (animationFrame === null) {
      animationFrame = requestAnimationFrameFn(animate);
    }
  }

  function handleInteraction() {
    void ensureGraph().then((ready) => {
      if (ready) updateAnimation();
    });
  }

  function handlePlay() {
    handleInteraction();
    updateAnimation();
  }

  function handleStopped() {
    stopAnimationFrame();
    reset();
  }

  function handleVisibilityChange() {
    if (document?.visibilityState === "hidden") {
      stopAnimationFrame();
    } else {
      updateAnimation();
    }
  }

  function handleMotionPreferenceChange() {
    if (!motionAllowed()) {
      handleStopped();
    } else if (!audio.paused) {
      handleInteraction();
    }
  }

  function start() {
    if (started || disposed) return;
    started = true;
    reset();
    window?.addEventListener?.("pointerdown", handleInteraction);
    window?.addEventListener?.("keydown", handleInteraction);
    document?.addEventListener?.("visibilitychange", handleVisibilityChange);
    reducedMotion?.addEventListener?.("change", handleMotionPreferenceChange);
    audio?.addEventListener?.("play", handlePlay);
    for (const eventName of ["pause", "ended", "emptied", "error"]) {
      audio?.addEventListener?.(eventName, handleStopped);
    }
    if (!audio.paused) handlePlay();
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    stopAnimationFrame();
    window?.removeEventListener?.("pointerdown", handleInteraction);
    window?.removeEventListener?.("keydown", handleInteraction);
    document?.removeEventListener?.("visibilitychange", handleVisibilityChange);
    reducedMotion?.removeEventListener?.("change", handleMotionPreferenceChange);
    audio?.removeEventListener?.("play", handlePlay);
    for (const eventName of ["pause", "ended", "emptied", "error"]) {
      audio?.removeEventListener?.(eventName, handleStopped);
    }
    if (source && analyser && analyserConnected) {
      try {
        source.disconnect(analyser);
      } catch {
        // The direct destination connection must stay intact until page teardown.
      }
    }
    analyserConnected = false;
    reset();
  }

  return { start, sample, destroy };
}

function startAudioReactiveWindow() {
  const audio = document.querySelector("#audio");
  const targets = [
    document.querySelector("#open-immersive-button"),
    document.querySelector(".immersive-art"),
  ].filter(Boolean);
  if (!audio || targets.length === 0) return;
  const controller = createAudioReactiveController({
    audio,
    targets,
    document,
    window,
    console,
  });
  controller.start();
  window.bilibiliMusicAudioReactive = controller;
  window.addEventListener("beforeunload", () => controller.destroy(), { once: true });
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  startAudioReactiveWindow();
}
