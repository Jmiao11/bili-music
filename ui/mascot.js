(() => {
  const MASCOTS = {
    kuro: {
      id: "kuro",
      name: "小黑咪",
      personality: "放歌就眯眼点头，收藏时尾巴卷成粉色小圈。",
      svg: `
        <svg class="mascot-svg mascot-kuro" viewBox="0 0 100 100" role="img" aria-label="小黑咪">
          <g id="tail">
            <path d="M25 67 C10 67 11 49 24 51 C32 52 31 61 25 59 C20 58 20 54 24 53" fill="none" stroke="#3B3D48" stroke-width="8" stroke-linecap="round"/>
            <path d="M22 52 C19 50 20 46 24 45" fill="none" stroke="#FB7299" stroke-width="4" stroke-linecap="round"/>
          </g>
          <g id="body">
            <path d="M29 43 C23 54 25 76 36 84 C44 90 60 90 68 84 C79 75 77 54 71 43 C62 31 38 31 29 43Z" fill="#333640"/>
            <path d="M40 63 C43 58 57 58 60 63 C63 72 58 80 50 80 C42 80 37 72 40 63Z" fill="#FFDD66"/>
            <circle cx="35" cy="76" r="5" fill="#FB7299"/>
            <circle cx="65" cy="76" r="5" fill="#FB7299"/>
          </g>
          <g id="ears">
            <path d="M31 31 L30 12 L45 28Z" fill="#333640"/>
            <path d="M69 31 L70 12 L55 28Z" fill="#333640"/>
            <path d="M36 27 L35 19 L42 29Z" fill="#FB7299"/>
            <path d="M64 27 L65 19 L58 29Z" fill="#FB7299"/>
          </g>
          <g id="head">
            <path d="M27 30 C30 18 41 14 50 14 C59 14 70 18 73 30 C78 48 67 61 50 61 C33 61 22 48 27 30Z" fill="#3B3D48"/>
            <path d="M34 46 C39 52 61 52 66 46 C63 57 37 57 34 46Z" fill="#525665"/>
            <circle cx="50" cy="44" r="3" fill="#FFDD66"/>
          </g>
          <g id="eyes">
            <ellipse cx="41" cy="36" rx="4.5" ry="5" fill="#8CFF72"/>
            <ellipse cx="59" cy="36" rx="4.5" ry="5" fill="#8CFF72"/>
            <circle cx="42.5" cy="34.5" r="1.2" fill="#FFFFFF"/>
            <circle cx="60.5" cy="34.5" r="1.2" fill="#FFFFFF"/>
          </g>
          <g id="whiskers">
            <path d="M31 43 H19 M31 49 H21 M69 43 H81 M69 49 H79" stroke="#C5C8D6" stroke-width="3" stroke-linecap="round"/>
          </g>
        </svg>
      `,
    },
  };

  const BLINK_MIN_MS = 6500;
  const BLINK_SPREAD_MS = 8000;
  const BLINK_DURATION_MS = 170;
  const TRACKCHANGE_DURATION_MS = 520;
  const POKE_DURATION_MS = 500;
  const EAR_TWITCH_DURATION_MS = 500;
  const LONG_LISTEN_MS = 60 * 60 * 1000;
  const DOZE_MS = 10 * 60 * 1000;

  const stage = document.querySelector("#mascot-stage");
  const slot = document.querySelector("#mascot-slot");
  const bubble = document.querySelector("#mascot-bubble");
  const audio = document.querySelector("#audio");

  if (!stage || !slot) {
    return;
  }

  let currentMascot = null;
  let hasCurrentTrack = false;
  let currentState = "";
  let blinkTimer = 0;
  let trackchangeTimer = 0;
  let pokeTimer = 0;
  let earTwitchTimer = 0;
  let longListenTimer = 0;
  let longListenStartedAt = 0;
  let longListenElapsed = 0;
  let dozeTimer = 0;

  stage.style.pointerEvents = "auto";

  function listen(target, eventName, handler) {
    try {
      target?.addEventListener(eventName, (event) => {
        try {
          handler(event);
        } catch (_) {
          // Ignore mascot-only event failures.
        }
      });
    } catch (_) {
      // Ignore mascot-only wiring failures.
    }
  }

  function renderMascot(mascot) {
    currentMascot = mascot;
    slot.innerHTML = mascot.svg;
    stage.dataset.mascotId = mascot.id;
    stage.dataset.mascotName = mascot.name;
    if (bubble) {
      bubble.hidden = true;
      bubble.textContent = "";
    }
  }

  function setState(state) {
    const changed = currentState !== state;
    currentState = state;
    stage.dataset.state = state;
    stage.classList.toggle("is-playing", state === "playing");
    stage.classList.toggle("is-paused", state === "paused");
    stage.classList.toggle("is-idle", state === "idle");
    updateLongListenClock();
    if (changed) {
      markActivity();
    }
  }

  function deriveAudioState() {
    if (!audio || !hasCurrentTrack || audio.ended) {
      return "idle";
    }
    return audio.paused ? "paused" : "playing";
  }

  function syncState() {
    setState(deriveAudioState());
  }

  function triggerBlink() {
    if (!currentMascot || document.hidden) {
      return;
    }
    stage.classList.add("is-blinking");
    window.setTimeout(() => stage.classList.remove("is-blinking"), BLINK_DURATION_MS);
  }

  function scheduleBlink() {
    window.clearTimeout(blinkTimer);
    const delay = BLINK_MIN_MS + Math.round(Math.random() * BLINK_SPREAD_MS);
    blinkTimer = window.setTimeout(() => {
      triggerBlink();
      scheduleBlink();
    }, delay);
  }

  function triggerTrackChange() {
    window.clearTimeout(trackchangeTimer);
    stage.classList.add("is-trackchanging");
    triggerBlink();
    trackchangeTimer = window.setTimeout(() => {
      stage.classList.remove("is-trackchanging");
      syncState();
    }, TRACKCHANGE_DURATION_MS);
  }

  function triggerPoke() {
    window.clearTimeout(pokeTimer);
    stage.classList.remove("is-poked");
    void stage.offsetWidth;
    stage.classList.add("is-poked");
    pokeTimer = window.setTimeout(() => stage.classList.remove("is-poked"), POKE_DURATION_MS);
  }

  function triggerEarTwitch() {
    window.clearTimeout(earTwitchTimer);
    stage.classList.remove("is-ear-twitch");
    void stage.offsetWidth;
    stage.classList.add("is-ear-twitch");
    earTwitchTimer = window.setTimeout(() => stage.classList.remove("is-ear-twitch"), EAR_TWITCH_DURATION_MS);
  }

  function updateLongListenClock() {
    window.clearTimeout(longListenTimer);
    if (longListenStartedAt) {
      longListenElapsed += Date.now() - longListenStartedAt;
      longListenStartedAt = 0;
    }
    if (currentState !== "playing" || document.hidden || stage.classList.contains("is-long-listen")) {
      return;
    }
    if (longListenElapsed >= LONG_LISTEN_MS) {
      stage.classList.add("is-long-listen");
      return;
    }
    longListenStartedAt = Date.now();
    longListenTimer = window.setTimeout(() => {
      longListenElapsed = LONG_LISTEN_MS;
      longListenStartedAt = 0;
      stage.classList.add("is-long-listen");
    }, LONG_LISTEN_MS - longListenElapsed);
  }

  function scheduleDoze() {
    window.clearTimeout(dozeTimer);
    if (document.hidden) {
      return;
    }
    dozeTimer = window.setTimeout(() => stage.classList.add("is-dozing"), DOZE_MS);
  }

  function markActivity() {
    stage.classList.remove("is-dozing");
    scheduleDoze();
  }

  renderMascot(MASCOTS.kuro);
  setState("idle");
  scheduleBlink();

  if (audio) {
    listen(audio, "play", () => {
      hasCurrentTrack = true;
      setState("playing");
    });
    listen(audio, "pause", syncState);
    listen(audio, "ended", () => setState("idle"));
  }

  listen(stage, "mouseenter", () => {
    markActivity();
    stage.classList.add("is-hovered");
    triggerBlink();
  });
  listen(stage, "mouseleave", () => {
    markActivity();
    stage.classList.remove("is-hovered");
  });
  listen(stage, "click", () => {
    markActivity();
    triggerPoke();
  });

  listen(window, "bilibili-music-trackchange", (event) => {
    markActivity();
    hasCurrentTrack = Boolean(event.detail?.hasCurrent);
    if (!hasCurrentTrack) {
      setState("idle");
      return;
    }
    triggerTrackChange();
    triggerEarTwitch();
    syncState();
  });

  listen(document, "visibilitychange", () => {
    stage.classList.toggle("is-document-hidden", document.hidden);
    updateLongListenClock();
    if (document.hidden) {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(dozeTimer);
      return;
    }
    markActivity();
    if (!document.hidden) {
      scheduleBlink();
      syncState();
    }
  });
})();
