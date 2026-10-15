import type { DeepReadonly } from "./state-store.ts";
import { normalizeShuffleCollectionPrefs } from "./page-selection.ts";
const ACCENT_COLORS = {
  pink: {
    dark: [251, 114, 153], light: [164, 41, 76]
  },
  blue: {
    dark: [122, 166, 231], light: [40, 88, 161]
  },
  purple: {
    dark: [189, 145, 236], light: [120, 48, 194]
  },
  green: {
    dark: [87, 185, 65], light: [40, 102, 25]
  },
  orange: {
    dark: [224, 146, 77], light: [128, 77, 32]
  },
  cyan: {
    dark: [73, 178, 191], light: [27, 98, 106]
  },
};
function normalizeSettingsNumber(value: unknown, min: number, max: number, fallback: number) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}
type SettingsCommand = "get_yt_dlp_availability" | "get_stream_source" | "set_stream_source" | "choose_background_image" | "load_background_image" | "get_audio_cache_settings" | "set_audio_cache_settings" | "get_audio_cache_usage" | "clear_audio_cache" | "get_shortcuts" | "set_shortcuts" | "get_ai_config" | "set_ai_config" | "test_ai_connection";
type SettingsPlatform = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  cancelCacheNotice(): void;
  scheduleCacheNotice(callback: () => void): void
};
type SettingsAdapter = {
  invoke: <K extends SettingsCommand>(command: K, ...args: CommandArguments<K>) => Promise<CommandMap[K]["result"]>;
  report(level: "warn" | "error", message: string, error: unknown): void;
  settings?: SettingsPlatform
};
type AiInput = {
  apiFormat: string;
  baseUrl: string;
  model: string;
  apiKey: string
};
type ShortcutAction = keyof CommandContract.ShortcutBindings;
type SettingsState = {
  controls: { dataBusy: { backupExport: boolean; backupImport: boolean; history: boolean }; mascots: {id:string;name:string;svg:string}[]; activeMascot:string; mascotGeneration:number };
  theme: string | null;
  accentColor: keyof typeof ACCENT_COLORS;
  glassBlur: number;
  panelAlpha: number;
  backgroundDim: number;
  background: CommandContract.BackgroundImage | null;
  ytDlpAvailable: boolean;
  streamSource: string;
  audioCacheSettings: CommandContract.AudioCacheSettings | null;
  collection: ReturnType<typeof normalizeShuffleCollectionPrefs>;
  shortcutBindings: CommandContract.ShortcutBindings;
  recordingShortcutAction: ShortcutAction | null;
  ai: {
    apiFormat: string;
    baseUrl: string;
    model: string;
    hasKey: boolean;
    request: "idle" | "loading" | "saving" | "testing"
  };
  session: {
    currentView: string | null;
    placeholderTitle: string;
    navigationVersion: number;
    panelOpen: boolean;
    panelVersion: number
  };
  view: {
    themeVersion: number;
    accent: {
      theme: string | null | undefined
    }
    | null;
    sliders: {
      kind: "all" | "blur" | "alpha" | "dim"
    }
    | null;
    backgroundVersion: number;
    notice: {
      text: string
    }
    | null;
    chooseDisabled: boolean;
    shortcuts: {
      action: ShortcutAction
    }
    | null;
    availabilityVersion: number;
    stream: {
      valueVersion: number;
      value: string | null;
      text: string | null;
      disabled: boolean | null
    };
    collectionVersion: number;
    cache: {
      settingsVersion: number;
      disabled: boolean | null;
      status: {
        text: string
      }
      | null;
      usageText: string | null;
      clearDisabled: boolean | null
    };
    ai: {
      fieldsVersion: number;
      clearKeyVersion: number;
      text: string | null;
      saveDisabled: boolean | null;
      testDisabled: boolean | null;
      placeholderVersion: number
    };
  };
};
type SettingsSnapshot = DeepReadonly<SettingsState>;
function initialSettingsState(): SettingsState {
  return {
    controls: {dataBusy: {backupExport:false, backupImport:false, history:false}, mascots:[], activeMascot:"none", mascotGeneration:0},
    theme: null, accentColor: "pink", glassBlur: 40, panelAlpha: 72, backgroundDim: 90, background: null, ytDlpAvailable: false, streamSource: "auto", audioCacheSettings: null, collection: {
      order: "random", limit: 0
    }, shortcutBindings: {
      previous: null, playPause: null, next: null, volumeUp: null, volumeDown: null
    }, recordingShortcutAction: null,
    ai: {
      apiFormat: "openai-chat-completions", baseUrl: "", model: "", hasKey: false, request: "idle"
    }, session: {
      currentView: "home", placeholderTitle: "", navigationVersion: 0, panelOpen: false, panelVersion: 0
    },
    view: {
      themeVersion: 0, accent: null, sliders: null, backgroundVersion: 0, notice: null, chooseDisabled: false, shortcuts: null, availabilityVersion: 0, stream: {
        valueVersion: 0, value: null, text: null, disabled: null
      }, collectionVersion: 0, cache: {
        settingsVersion: 0, disabled: null, status: null, usageText: null, clearDisabled: null
      }, ai: {
        fieldsVersion: 0, clearKeyVersion: 0, text: null, saveDisabled: null, testDisabled: null, placeholderVersion: 0
      }
    }
  };
}
function normalizeSettingsAccent(value: unknown): keyof typeof ACCENT_COLORS {
  return typeof value === "string" && Object.hasOwn(ACCENT_COLORS, value) ? value as keyof typeof ACCENT_COLORS : "pink";
}
function accentChannels(color: unknown, theme: string | null | undefined) {
  return ACCENT_COLORS[normalizeSettingsAccent(color)][theme === "light" ? "light" : "dark"];
}
function redactAiText(value: unknown, keys: readonly string[]): string {
  let result = String(value);
  for (const key of keys) if (key) result = result.split(key).join("[已隐藏]");
  return result;
}
function createSettingsActions(read: () => SettingsSnapshot, commit: (next: SettingsSnapshot) => void, adapter: SettingsAdapter) {
  const key = (name: string) => "bilibili-music." + name;
  const update = (fields: Partial<SettingsSnapshot>, view: Partial<SettingsSnapshot["view"]> = {
  }) => commit({
    ...read(), ...fields, view: Object.keys(view).length ? {
      ...read().view, ...view
    } : read().view
  });
  const notice = (text: string) => update({
  }, {
    notice: {
      text
    }
  });
  const cacheView = (fields: Partial<SettingsSnapshot["view"]["cache"]>, state: Partial<SettingsSnapshot> = {
  }) => update(state, {
    cache: {
      ...read().view.cache, ...fields
    }
  });
  const streamView = (fields: Partial<SettingsSnapshot["view"]["stream"]>, state: Partial<SettingsSnapshot> = {
  }) => update(state, {
    stream: {
      ...read().view.stream, ...fields, valueVersion: read().view.stream.valueVersion + ("value" in fields ? 1 : 0)
    }
  });
  const aiView = (fields: Partial<SettingsSnapshot["view"]["ai"]>, state: Partial<SettingsSnapshot["ai"]> = {
  }) => update({
    ai: {
      ...read().ai, ...state
    }
  }, {
    ai: {
      ...read().view.ai, ...fields
    }
  });
  function setTheme(value: string | null, persist = true): void {
    const theme = ["dark", "light", "image", "dynamic"].includes(value ?? "") ? String(value) : "dark";
    update({
      theme
    }, {
      themeVersion: read().view.themeVersion + 1
    });
    if (theme !== "dynamic") {
      setSlider("blur", adapter.settings?.getItem(key("glass-blur")), false);
      setSlider("alpha", adapter.settings?.getItem(key("panel-alpha")), false);
      setSlider("dim", adapter.settings?.getItem(key("background-dim")), false);
    }
    if (persist) adapter.settings?.setItem(key("theme"), theme);
  }
  function setAccent(value: unknown, theme: string | null | undefined, persist = true): void {
    const accentColor = normalizeSettingsAccent(value);
    update({
      accentColor
    }, {
      accent: {
        theme
      }
    });
    if (persist) try {
      adapter.settings?.setItem(key("accent-color"), accentColor);
    } catch {
    }
  }
  function setSlider(kind: "blur" | "alpha" | "dim", value: unknown, persist = true): void {
    const field = kind === "blur" ? "glassBlur" : kind === "alpha" ? "panelAlpha" : "backgroundDim";
    const safe = kind === "blur" ? normalizeSettingsNumber(value, 0, 80, 40) : kind === "alpha" ? normalizeSettingsNumber(value, 20, 100, 72) : normalizeSettingsNumber(value, 40, 95, 90);
    update({
      [field]: safe
    }, {
      sliders: {
        kind
      }
    });
    if (persist) adapter.settings?.setItem(key(kind === "blur" ? "glass-blur" : kind === "alpha" ? "panel-alpha" : "background-dim"), String(safe));
  }
  function applyImage(image: CommandContract.BackgroundImage): void {
    update({
      background: {
        ...image
      }
    }, {
      backgroundVersion: read().view.backgroundVersion + 1
    });
  }
  function resetSettingsBackground({
    clearStorage = true
  }
  = {
  }): void {
    update({
      background: null
    }, {
      backgroundVersion: read().view.backgroundVersion + 1, notice: {
        text: ""
      }
    });
    if (clearStorage) adapter.settings?.removeItem(key("background-path"));
  }
  async function restoreSettingsBackground(): Promise<void> {
    const path = adapter.settings?.getItem(key("background-path"));
    if (!path) return;
    notice("正在恢复背景…");
    try {
      applyImage(await adapter.invoke("load_background_image", {
        path
      }));
      notice("");
    } catch (error) {
      resetSettingsBackground();
      notice(`背景已回退为默认：${error}`);
    }
  }
  async function chooseBackground(): Promise<void> {
    update({
    }, {
      chooseDisabled: true, notice: {
        text: "正在处理图片…"
      }
    });
    try {
      const image = await adapter.invoke("choose_background_image");
      if (!image) {
        notice("");
        return;
      }
      applyImage(image);
      adapter.settings?.setItem(key("background-path"), image.path);
      setTheme("image");
      notice("背景已保存。");
    } catch (error) {
      notice(`背景设置失败：${error}`);
    } finally {
      update({
      }, {
        chooseDisabled: false
      });
    }
  }
  async function refreshAvailability(): Promise<boolean> {
    let ytDlpAvailable = false;
    try {
      ytDlpAvailable = Boolean((await adapter.invoke("get_yt_dlp_availability"))?.available);
    } catch (error) {
      adapter.report("warn", "get_yt_dlp_availability failed:", error);
    }
    update({
      ytDlpAvailable
    }, {
      availabilityVersion: read().view.availabilityVersion + 1
    });
    return ytDlpAvailable;
  }
  const sourceLabel = (source: string) => source === "guest" ? "当前：游客直连" : "当前：自动（游客优先，yt-dlp 兜底）";
  const sourceHint = () => "自动模式需在程序目录放置 yt-dlp.exe 后启用";
  async function restoreSource(): Promise<void> {
    try {
      await refreshAvailability();
      let source = await adapter.invoke("get_stream_source");
      if (source === "yt-dlp" || source === "auto" && !read().ytDlpAvailable) source = await adapter.invoke("set_stream_source", {
        source: "guest"
      });
      const value = source === "auto" && read().ytDlpAvailable ? "auto" : "guest";
      streamView({
        value, text: source === "auto" && read().ytDlpAvailable ? sourceLabel("auto") : read().ytDlpAvailable ? sourceLabel("guest") : sourceLabel("guest") + "；" + sourceHint()
      }, {
        streamSource: source
      });
    } catch (error) {
      streamView({
        text: `取流方案读取失败：${error}`
      });
    }
  }
  async function changeSource(source: string): Promise<void> {
    if (source === "auto" && !read().ytDlpAvailable) {
      streamView({
        value: "guest", text: sourceLabel("guest") + "；" + sourceHint()
      }, {
        streamSource: "guest"
      });
      return;
    }
    streamView({
      disabled: true, text: "正在切换取流方案…"
    });
    try {
      const value = await adapter.invoke("set_stream_source", {
        source
      });
      streamView({
        value, text: sourceLabel(value)
      }, {
        streamSource: value
      });
    } catch (error) {
      streamView({
        text: `取流方案切换失败：${error}`
      });
      await restoreSource();
    } finally {
      streamView({
        disabled: false
      });
    }
  }
  async function restoreCache(): Promise<void> {
    adapter.settings?.cancelCacheNotice();
    cacheView({
      disabled: true
    }, {
      audioCacheSettings: null
    });
    try {
      const audioCacheSettings = await adapter.invoke("get_audio_cache_settings");
      cacheView({
        settingsVersion: read().view.cache.settingsVersion + 1, status: {
          text: ""
        }
      }, {
        audioCacheSettings: {
          ...audioCacheSettings
        }
      });
    } catch (error) {
      cacheView({
        status: {
          text: `缓存设置读取失败：${error}`
        }
      });
    } finally {
      cacheView({
        disabled: !read().audioCacheSettings
      });
    }
  }
  async function refreshCacheUsage(): Promise<void> {
    cacheView({
      usageText: "读取中…"
    });
    try {
      const {
        bytes, items
      }
      = await adapter.invoke("get_audio_cache_usage");
      const size = bytes === 0 ? "0 MB" : bytes < 1048576 ? "不足 1 MB" : `${(bytes / 1048576).toFixed(1)} MB`;
      cacheView({
        usageText: `${size} · ${items} 首`
      });
    } catch (error) {
      cacheView({
        usageText: `读取失败：${error}`
      });
    }
  }
  async function saveCache(enabled: boolean, maxBytes: number): Promise<void> {
    if (!read().audioCacheSettings) return;
    adapter.settings?.cancelCacheNotice();
    cacheView({
      disabled: true
    });
    try {
      const audioCacheSettings = await adapter.invoke("set_audio_cache_settings", {
        enabled, maxBytes
      });
      cacheView({
        settingsVersion: read().view.cache.settingsVersion + 1, status: {
          text: ""
        }
      }, {
        audioCacheSettings: {
          ...audioCacheSettings
        }
      });
      await refreshCacheUsage();
    } catch (error) {
      cacheView({
        settingsVersion: read().view.cache.settingsVersion + 1, status: {
          text: `缓存设置保存失败：${error}`
        }
      });
    } finally {
      cacheView({
        disabled: false
      });
    }
  }
  async function clearCache(): Promise<void> {
    adapter.settings?.cancelCacheNotice();
    cacheView({
      clearDisabled: true, status: {
        text: "正在清空缓存…"
      }
    });
    try {
      await adapter.invoke("clear_audio_cache");
      await refreshCacheUsage();
      cacheView({
        status: {
          text: "缓存已清空"
        }
      });
      adapter.settings?.scheduleCacheNotice(() => cacheView({
        status: {
          text: ""
        }
      }));
    } catch (error) {
      cacheView({
        status: {
          text: `清空缓存失败：${error}`
        }
      });
    } finally {
      cacheView({
        clearDisabled: false
      });
    }
  }
  function restoreCollection(order: unknown, limit: string | null): void {
    update({
      collection: normalizeShuffleCollectionPrefs(order, limit)
    }, {
      collectionVersion: read().view.collectionVersion + 1
    });
  }
  function saveCollection(name: "order" | "limit", value: string): void {
    const before = read().collection;
    update({
      collection: normalizeShuffleCollectionPrefs(name === "order" ? value : before.order, name === "limit" ? value : before.limit === 0 ? "all" : String(before.limit))
    });
    try {
      adapter.settings?.setItem(key("shuffle-collection-" + name), value);
    } catch (error) {
      notice(`随机播放设置保存失败：${error}`);
    }
  }
  function beginRecording(action: ShortcutAction): void {
    update({
      recordingShortcutAction: action
    }, {
      shortcuts: {
        action
      }, notice: {
        text: ""
      }
    });
  }
  function cancelRecording(): void {
    const action = read().recordingShortcutAction;
    if (action) update({
      recordingShortcutAction: null
    }, {
      shortcuts: {
        action
      }
    });
  }
  async function saveShortcut(action: ShortcutAction, value: string | null): Promise<void> {
    const bindings = {
      ...read().shortcutBindings, [action]: value
    };
    try {
      await adapter.invoke("set_shortcuts", {
        bindings
      });
      update({
        shortcutBindings: bindings
      }, {
        shortcuts: {
          action
        }, notice: {
          text: "快捷键已保存。"
        }
      });
    } catch (error) {
      notice(String(error));
    }
  }
  async function loadShortcuts(): Promise<void> {
    try {
      const result = await adapter.invoke("get_shortcuts");
      update({
        shortcutBindings: {
          ...read().shortcutBindings, ...result.bindings
        }
      });
    } catch (error) {
      adapter.report("warn", "[shortcut] cannot load settings:", error);
    }
  }
  function configText(config: CommandContract.AiConfigView): string {
    const hint = config.keyHint;
    return config.hasKey ? `API Key 已配置${hint ? `（${hint}）` : ""}` : "API Key 未配置";
  }
  function publicAi(input: {
    apiFormat?: string;
    baseUrl?: string;
    model?: string;
    hasKey?: boolean
  }, keys: readonly string[] = []) {
    return {
      apiFormat: redactAiText(input.apiFormat ?? "openai-chat-completions", keys), baseUrl: redactAiText(input.baseUrl ?? "", keys), model: redactAiText(input.model ?? "", keys), ...(input.hasKey !== undefined ? {
        hasKey: input.hasKey
      } : {
      })
    };
  }
  async function restoreAi(): Promise<void> {
    aiView({
      text: "正在读取 AI 配置…"
    }, {
      request: "loading"
    });
    try {
      const config = await adapter.invoke("get_ai_config");
      aiView({
        fieldsVersion: read().view.ai.fieldsVersion + 1, clearKeyVersion: read().view.ai.clearKeyVersion + 1, text: configText(config), placeholderVersion: read().view.ai.placeholderVersion + 1
      }, {
        ...publicAi(config), request: "idle"
      });
    } catch (error) {
      aiView({
        text: `AI 配置读取失败：${error}`
      }, {
        request: "idle"
      });
    }
  }
  async function saveAi(input: AiInput, latest: () => AiInput = () => input, onSaved: () => void = () => {
  }): Promise<boolean | undefined> {
    const keys = [input.apiKey];
    aiView({
      saveDisabled: true, text: "正在验证并保存 AI 配置…"
    }, {
      ...publicAi(input, keys), request: "saving"
    });
    try {
      const result = await adapter.invoke("test_ai_connection", input);
      if (!result.ok) {
        aiView({
          text: "连接测试未通过，未保存：" + redactAiText(result.message, keys)
        });
        return;
      }
      const next = latest();
      keys.push(next.apiKey);
      const config = await adapter.invoke("set_ai_config", next);
      aiView({
        clearKeyVersion: read().view.ai.clearKeyVersion + 1, text: "连接正常，配置已保存。"
      }, {
        hasKey: config.hasKey
      });
      onSaved();
      return true;
    } catch (error) {
      aiView({
        text: "AI 配置保存失败：" + redactAiText(error, keys)
      });
    } finally {
      aiView({
        saveDisabled: false
      }, {
        request: "idle"
      });
    }
  }
  async function testAi(input: AiInput): Promise<void> {
    aiView({
      testDisabled: true, text: "正在测试 AI 连接…"
    }, {
      ...publicAi(input, [input.apiKey]), request: "testing"
    });
    try {
      const result = await adapter.invoke("test_ai_connection", input);
      aiView({
        text: result.ok ? "AI 连接正常。" : "AI 连接失败：" + redactAiText(result.message, [input.apiKey])
      });
    } catch (error) {
      aiView({
        text: "AI 连接测试失败：" + redactAiText(error, [input.apiKey])
      });
    } finally {
      aiView({
        testDisabled: false
      }, {
        request: "idle"
      });
    }
  }
  function setAiFormat(apiFormat: string): void {
    aiView({
      placeholderVersion: read().view.ai.placeholderVersion + 1
    }, {
      apiFormat
    });
  }
  function navigate(currentView: string): void {
    const labels: Record<string, string> = {
      favorites: "我的收藏", playlists: "我的歌单", local: "本地音乐"
    };
    update({
      session: {
        ...read().session, currentView, placeholderTitle: `${labels[currentView] ?? "功能"}开发中`, navigationVersion: read().session.navigationVersion + 1
      }
    });
  }
  function panel(open: boolean): void {
    update({
      session: {
        ...read().session, panelOpen: open, panelVersion: read().session.panelVersion + 1
      }
    });
  }
  function setDataBusy(kind: "backupExport" | "backupImport" | "history", busy: boolean): void { update({controls:{...read().controls,dataBusy:{...read().controls.dataBusy,[kind]:busy}}}); }
  function showMascots(mascots: readonly {id:string;name:string;svg:string}[], activeMascot: string): void { update({controls:{...read().controls,mascots:mascots.map(item=>({...item})),activeMascot,mascotGeneration:read().controls.mascotGeneration+1}}); }
  function selectMascot(activeMascot: string): void { update({controls:{...read().controls,activeMascot}}); }
  return {
    setDataBusy, showMascots, selectMascot, setTheme, setAccent, setSlider, applyImage, resetBackground: resetSettingsBackground, restoreBackground: restoreSettingsBackground, chooseBackground, refreshAvailability, restoreSource, changeSource, restoreCache, refreshCacheUsage, saveCache, clearCache, restoreCollection, saveCollection, beginRecording, cancelRecording, saveShortcut, loadShortcuts, restoreAi, saveAi, testAi, setAiFormat, navigate, panel, setNotice: notice
  };
}
export { accentChannels, createSettingsActions, initialSettingsState, normalizeSettingsAccent };
export type { AiInput, SettingsCommand, SettingsPlatform, SettingsSnapshot };
