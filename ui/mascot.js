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
    nuomi: {
      id: "nuomi",
      name: "糯米飘",
      personality: "轻飘飘地待着，情绪稳定但很会凑热闹。",
      svg: `
          <svg class="mascot-svg mascot-nuomi" viewBox="0 0 100 100" role="img" aria-label="糯米飘大图">
            <g id="cape">
              <path d="M22 54 C22 38 34 25 50 25 C66 25 78 38 78 54 V80 C72 76 66 84 60 79 C54 75 49 86 43 79 C38 73 31 84 25 78 C22 75 22 66 22 54Z" fill="#F7F3FF"/>
              <path d="M28 67 C35 72 43 72 50 67 C57 72 65 72 72 67 V80 C66 76 60 83 55 78 C50 73 44 84 38 78 C34 74 29 80 25 76 Z" fill="#D8C7FF"/>
            </g>
            <g id="body">
              <path d="M27 45 C29 33 39 27 50 27 C61 27 71 33 73 45 C76 62 66 73 50 73 C34 73 24 62 27 45Z" fill="#F7F3FF"/>
              <circle cx="35" cy="56" r="5" fill="#FB7299"/>
              <circle cx="65" cy="56" r="5" fill="#FB7299"/>
            </g>
            <g id="head">
              <path d="M31 34 C36 24 45 20 50 20 C55 20 64 24 69 34 C61 31 39 31 31 34Z" fill="#CDB8FF"/>
              <circle cx="39" cy="26" r="4" fill="#FFE36E"/>
              <circle cx="61" cy="26" r="4" fill="#80E36A"/>
            </g>
            <g id="eyes">
              <path d="M39 47 Q43 51 47 47" fill="none" stroke="#3F3657" stroke-width="3" stroke-linecap="round"/>
              <path d="M53 47 Q57 51 61 47" fill="none" stroke="#3F3657" stroke-width="3" stroke-linecap="round"/>
            </g>
            <g id="paws">
              <circle cx="30" cy="61" r="4" fill="#E4D9FF"/>
              <circle cx="70" cy="61" r="4" fill="#E4D9FF"/>
            </g>
          </svg>
      `,
    },
    juzi: {
      id: "juzi",
      name: "橘子汪",
      personality: "反应很快，听到下一首就先精神起来。",
      svg: `
          <svg class="mascot-svg mascot-juzi" viewBox="0 0 100 100" role="img" aria-label="橘子汪大图">
            <g id="tail">
              <path d="M72 60 C88 55 87 39 76 43" fill="none" stroke="#FF9F43" stroke-width="9" stroke-linecap="round"/>
            </g>
            <g id="body">
              <path d="M25 49 C25 38 34 31 50 31 C66 31 75 38 75 49 V70 C75 80 66 87 50 87 C34 87 25 80 25 70Z" fill="#FFB55A"/>
              <path d="M37 64 C40 58 60 58 63 64 C66 74 59 81 50 81 C41 81 34 74 37 64Z" fill="#FFF1D4"/>
              <circle cx="34" cy="74" r="5" fill="#8FD466"/>
              <circle cx="66" cy="74" r="5" fill="#8FD466"/>
            </g>
            <g id="ears">
              <path d="M31 35 C21 25 20 13 32 15 C42 17 41 29 36 38Z" fill="#E77E35"/>
              <path d="M69 35 C79 25 80 13 68 15 C58 17 59 29 64 38Z" fill="#E77E35"/>
            </g>
            <g id="head">
              <path d="M28 28 C34 17 44 14 50 14 C56 14 66 17 72 28 C79 43 70 58 50 58 C30 58 21 43 28 28Z" fill="#FFC06B"/>
              <path d="M42 43 C45 39 55 39 58 43 C58 49 42 49 42 43Z" fill="#FFF1D4"/>
              <circle cx="50" cy="42" r="3" fill="#5A3320"/>
            </g>
            <g id="eyes">
              <circle cx="40" cy="34" r="3.8" fill="#382317"/>
              <circle cx="60" cy="34" r="3.8" fill="#382317"/>
              <circle cx="41.5" cy="32.5" r="1.2" fill="#FFFFFF"/>
              <circle cx="61.5" cy="32.5" r="1.2" fill="#FFFFFF"/>
            </g>
            <g id="scarf">
              <path d="M38 57 H62" stroke="#FB7299" stroke-width="5" stroke-linecap="round"/>
              <circle cx="50" cy="60" r="3" fill="#FFE36E"/>
            </g>
          </svg>
      `,
    },
  };

  const MASCOT_KEY = "bili-music-mascot";
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

  function getSavedMascot() {
    try {
      return MASCOTS[localStorage.getItem(MASCOT_KEY)] ?? MASCOTS.kuro;
    } catch (_) {
      return MASCOTS.kuro;
    }
  }

  function saveMascot(id) {
    try {
      localStorage.setItem(MASCOT_KEY, id);
    } catch (_) {
      // Ignore mascot preference persistence failures.
    }
  }

  window.BiliMascot = {
    list() {
      return Object.values(MASCOTS).map(({ id, name, svg }) => ({ id, name, svg }));
    },
    getActive() {
      return currentMascot?.id;
    },
    setActive(id) {
      const mascot = MASCOTS[id] ?? MASCOTS.kuro;
      renderMascot(mascot);
      saveMascot(mascot.id);
      syncState();
      return mascot.id;
    },
  };

  renderMascot(getSavedMascot());
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
