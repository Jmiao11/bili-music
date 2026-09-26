const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(path.join(__dirname, "../ui/audio-reactive.js"), "utf8");
const createAudioReactiveController = vm.runInNewContext(
  `${source}\ncreateAudioReactiveController`,
  { EventTarget, Event, console: { warn() {} } },
);
const settle = () => new Promise((resolve) => setImmediate(resolve));

function style() {
  return {
    values: {},
    setProperty(name, value) {
      this.values[name] = String(value);
    },
  };
}

function setup({
  resumeFails = false,
  reducedMotion = false,
  spectrumLevel = 140,
  includeImmersive = false,
  getDataThrows = false,
} = {}) {
  const audio = Object.assign(new EventTarget(), {
    paused: true,
    ended: false,
    currentSrc: "",
  });
  const target = { style: style() };
  const immersiveTarget = { style: style() };
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const window = new EventTarget();
  const mediaQuery = Object.assign(new EventTarget(), { matches: reducedMotion });
  const frames = new Map();
  const warns = [];
  let nextFrame = 0;

  class FakeAnalyser {
    constructor() {
      this.fftSize = 1024;
      this.frequencyBinCount = 512;
      this.smoothingTimeConstant = 0;
      this.minDecibels = 0;
      this.maxDecibels = 0;
      this.values = new Uint8Array(this.frequencyBinCount);
      this.values.fill(spectrumLevel);
    }

    getByteFrequencyData(output) {
      if (getDataThrows) throw new Error("analyser unavailable");
      output.set(this.values.subarray(0, output.length));
    }
  }

  class FakeSource {
    constructor() {
      this.connections = [];
    }

    connect(node) {
      this.connections.push(node);
      return node;
    }
  }

  class FakeAudioContext {
    constructor() {
      this.state = "suspended";
      this.sampleRate = 48_000;
      this.destination = { kind: "destination" };
      this.analyser = new FakeAnalyser();
      this.source = new FakeSource();
      this.sourceCreations = 0;
      setup.contexts.push(this);
    }

    async resume() {
      if (resumeFails) throw new Error("blocked");
      this.state = "running";
    }

    createAnalyser() {
      return this.analyser;
    }

    createMediaElementSource(element) {
      assert.equal(element, audio);
      this.sourceCreations += 1;
      return this.source;
    }
  }

  setup.contexts = [];
  const controller = createAudioReactiveController({
    audio,
    target,
    targets: includeImmersive ? [target, immersiveTarget] : undefined,
    document,
    window,
    AudioContextCtor: FakeAudioContext,
    matchMedia: () => mediaQuery,
    requestAnimationFrameFn(callback) {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrameFn(id) {
      frames.delete(id);
    },
    console: { warn: (...args) => warns.push(args) },
  });

  return {
    audio, target, immersiveTarget, document, window, mediaQuery, frames, warns, controller,
    contexts: setup.contexts,
  };
}

test("creates one media source and keeps a direct audio path to destination", async () => {
  const app = setup();
  app.controller.start();
  app.window.dispatchEvent(new Event("pointerdown"));
  await settle();
  app.window.dispatchEvent(new Event("pointerdown"));
  await settle();

  assert.equal(app.contexts.length, 1);
  assert.equal(app.contexts[0].sourceCreations, 1);
  assert.equal(app.contexts[0].source.connections[0], app.contexts[0].destination);
  assert.equal(app.contexts[0].source.connections[1], app.contexts[0].analyser);
});

test("samples a bounded visual frame and resets it when playback pauses", async () => {
  const app = setup();
  app.controller.start();
  app.window.dispatchEvent(new Event("pointerdown"));
  await settle();
  app.audio.paused = false;
  app.audio.currentSrc = "http://127.0.0.1:1234/audio/token";

  const frame = app.controller.sample();
  assert.equal(frame.active, true);
  assert.ok(frame.pulse > 0 && frame.pulse <= 1);
  assert.ok(frame.glow > 0 && frame.glow <= 1);
  assert.match(app.target.style.values["--audio-cover-scale"], /^1\.\d+$/);
  assert.match(app.target.style.values["--audio-cover-glow-size"], /^\d+(?:\.\d+)?px$/);

  app.audio.paused = true;
  app.audio.dispatchEvent(new Event("pause"));
  const reset = app.controller.sample();
  assert.deepEqual(
    { active: reset.active, pulse: reset.pulse, glow: reset.glow },
    { active: false, pulse: 0, glow: 0 },
  );
  assert.equal(app.target.style.values["--audio-cover-scale"], "1.0000");
});

test("moderate music produces perceptible cover motion", async () => {
  const app = setup({ spectrumLevel: 96 });
  app.controller.start();
  app.window.dispatchEvent(new Event("pointerdown"));
  await settle();
  app.audio.paused = false;

  for (let index = 0; index < 6; index += 1) {
    app.controller.sample();
  }

  const scale = Number(app.target.style.values["--audio-cover-scale"]);
  const glowSize = Number.parseFloat(app.target.style.values["--audio-cover-glow-size"]);
  assert.ok(scale >= 1.02, `expected perceptible scale, got ${scale}`);
  assert.ok(glowSize >= 10, `expected perceptible glow, got ${glowSize}px`);
});

test("the shared audio frame also animates the immersive cover", async () => {
  const app = setup({ includeImmersive: true });
  app.controller.start();
  app.window.dispatchEvent(new Event("pointerdown"));
  await settle();
  app.audio.paused = false;

  app.controller.sample();

  assert.equal(
    app.immersiveTarget.style.values["--audio-cover-scale"],
    app.target.style.values["--audio-cover-scale"],
  );
  assert.notEqual(app.immersiveTarget.style.values["--audio-cover-scale"], "1.0000");
});

test("window bootstrap registers the immersive artwork as a visual consumer", () => {
  assert.match(source, /document\.querySelector\("\.immersive-art"\)/);
});

test("does not take ownership of media output when AudioContext cannot run", async () => {
  const app = setup({ resumeFails: true });
  app.controller.start();
  app.window.dispatchEvent(new Event("pointerdown"));
  await settle();

  assert.equal(app.contexts.length, 1);
  assert.equal(app.contexts[0].sourceCreations, 0);
  assert.equal(app.controller.sample().active, false);
  assert.equal(app.frames.size, 0);
});

test("reduced motion keeps the feature inactive without creating an AudioContext", async () => {
  const app = setup({ reducedMotion: true });
  app.controller.start();
  app.window.dispatchEvent(new Event("pointerdown"));
  await settle();

  assert.equal(app.contexts.length, 0);
  assert.equal(app.controller.sample().active, false);
  assert.equal(app.target.style.values["--audio-cover-scale"], "1.0000");
});

test("a transient analyser read failure does not terminate the animation loop", async () => {
  const app = setup({ getDataThrows: true });
  app.controller.start();
  app.window.dispatchEvent(new Event("pointerdown"));
  await settle();
  app.audio.paused = false;
  app.audio.dispatchEvent(new Event("play"));
  await settle();

  const [id, callback] = app.frames.entries().next().value;
  app.frames.delete(id);
  assert.doesNotThrow(() => callback(100));
  assert.equal(app.warns.length, 1);
  assert.equal(app.target.style.values["--audio-cover-scale"], "1.0000");
  assert.equal(app.frames.size, 1);
});
