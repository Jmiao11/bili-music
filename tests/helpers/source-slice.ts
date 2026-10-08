import { createRequire, stripTypeScriptTypes } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { isTypeScript, eraseTypes } from "./typescript-source.ts";

const sourceSliceModuleExceptions = [
  { file: "ui/appearance.ts", start: "function applyVolume(", end: "function startAppearance()",
    modules: ["app-state.ts", "playback-settings-state.ts", "media-adapter.ts", "playback-settings-view.ts"],
    reason: "Frozen volume and loudness tests need the real store, media adapter and readonly projection." },
  { file: "ui/appearance.ts", start: "function applyLoudnessNormalization(", end: "function initializeLoudnessNormalization(",
    modules: ["app-state.ts", "playback-settings-state.ts", "media-adapter.ts", "playback-settings-view.ts"],
    reason: "Frozen isolated toggle tests need the same real modules and controller wiring." },
] as const;

function buildSliceModulePrelude(): string {
  const { moduleDeclarations, stripModuleSyntax }: import("./module-syntax.ts").Contract = createRequire(import.meta.url)("./module-syntax.ts");
  const modules = new Map<string, string>();
  function visit(file: string): void {
    if (modules.has(file)) return;
    const source = stripTypeScriptTypes(fs.readFileSync(path.join(import.meta.dirname, "../../ui", file), "utf8"), { mode: "strip" });
    const declarations = moduleDeclarations(source);
    modules.set(file, "");
    const imports = declarations.filter(item => item.kind === "import").map(item => {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), item.specifier));
      visit(dependency);
      return item.names.length ? `const { ${item.names.join(", ")} } = load(${JSON.stringify(dependency)});` : `load(${JSON.stringify(dependency)});`;
    });
    const exports = declarations.filter(item => item.kind === "export").flatMap(item => item.names);
    modules.set(file, `${JSON.stringify(file)}: (load) => { ${imports.join("\n")}\n${stripModuleSyntax(source)}\nreturn { ${exports.join(", ")} }; }`);
  }
  for (const file of sourceSliceModuleExceptions[0].modules) visit(file);
  return `var __sliceRealModules = (() => {
    const factories = { ${[...modules.values()].join(",\n")} }, cache = new Map();
    function load(file) { if (!cache.has(file)) cache.set(file, factories[file](load)); return cache.get(file); }
    return Object.assign({}, ${sourceSliceModuleExceptions[0].modules.map(file => `load(${JSON.stringify(file)})`).join(", ")});
  })();
  var effectivePlaybackVolume = __sliceRealModules.effectivePlaybackVolume;
  var createMediaAdapter = __sliceRealModules.createMediaAdapter;
  var renderPlaybackSettingsSnapshot = __sliceRealModules.renderPlaybackSettingsSnapshot;
  var getApplicationStore = typeof getApplicationStore === "function" ? getApplicationStore : (() => {
    let store;
    return () => store ??= __sliceRealModules.createApplicationStore({
      invoke: (...args) => (typeof invokeAppearance === "function" ? invokeAppearance : invoke)(...args),
      setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
      report: (level, message, error) => console[level](message, error),
    });
  })();\n`;
}

let sliceModulePrelude: string | null = null;

function sourceSlice(source: string, file: string, startMarker: string | null, endMarker: string, {
  endAfterStart = false,
  startLastBefore = null,
  includeEnd = false,
  stripModules = true,
}: { endAfterStart?: boolean; startLastBefore?: string | null; includeEnd?: boolean; stripModules?: boolean } = {}) {
  const erased = eraseTypes(source, file);
  if (isTypeScript(file) && stripModules) {
    source = createRequire(import.meta.url)("./module-syntax.ts").stripModuleSyntax(source, file);
  } else {
    source = erased;
  }
  const find = (marker: string, from = 0) => {
    const index = source.indexOf(marker, from);
    if (index < 0) throw new Error(`${file}: marker not found: ${JSON.stringify(marker)}`);
    return index;
  };

  const start = startMarker === null
    ? 0
    : startLastBefore === null
      ? find(startMarker)
      : source.lastIndexOf(startMarker, find(startLastBefore));
  if (start < 0) throw new Error(`${file}: marker not found: ${JSON.stringify(startMarker)}`);
  const end = find(endMarker, endAfterStart ? start : 0);
  if (end <= start) {
    throw new Error(`${file}: end marker ${JSON.stringify(endMarker)} is not after start marker ${JSON.stringify(startMarker)}`);
  }
  const slice = source.slice(start, end + (includeEnd ? endMarker.length : 0));
  const exception = sourceSliceModuleExceptions.find(item => item.file === file && item.start === startMarker && item.end === endMarker);
  if (!exception) return slice;
  const helperStart = source.indexOf("function getPlaybackSettingsActions(");
  const controller = helperStart >= 0 && !slice.includes("function getPlaybackSettingsActions(")
    ? source.slice(helperStart, source.indexOf("function startAppearance()", helperStart)) : "";
  const bindings = controller ? [...source.matchAll(/^let playbackSettings(?:Mounted|Media)[^;]*;/gm)].map(match => match[0]).join("\n") : "";
  return (sliceModulePrelude ??= buildSliceModulePrelude()) + bindings + "\n" + controller + slice;
}

export { sourceSlice, sourceSliceModuleExceptions };

export type Contract = { sourceSlice: typeof sourceSlice };
