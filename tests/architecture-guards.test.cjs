const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const ui = path.join(__dirname, "../ui");
const html = readFileSync(path.join(ui, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
  .map((match) => match[1].replace(/^\.\//, ""));
const expected = [
  "sidebar.js",
  "window-controls.js",
  "dynamic-background.js",
  "page-selection.js",
  "track-utils.js",
  "home.js",
  "library-ui.js",
  "video-pages.js",
  "search.js",
  "main.js",
  "appearance.js",
  "lyrics.js",
  "mascot.js",
  "mini-player-host.js",
];
const splitScripts = ["page-selection.js", "track-utils.js", "home.js", "library-ui.js", "video-pages.js", "search.js"];

test("main-window script list and files match the approved order", () => {
  assert.deepEqual(scripts, expected);
  for (const script of scripts) assert.ok(existsSync(path.join(ui, script)), `missing ${script}`);
});

test("main-window scripts have no conflicting lexical declarations", () => {
  const source = scripts.map((script) => readFileSync(path.join(ui, script), "utf8")).join("\n");
  new vm.Script(source);
});

test("main-window scripts have no duplicate top-level function names", () => {
  const seen = new Map();
  // Only unindented declarations are scanned; functions inside IIFEs are intentionally excluded.
  for (const script of scripts) {
    const source = readFileSync(path.join(ui, script), "utf8");
    for (const match of source.matchAll(/^(?:async\s+)?function\s+([\w$]+)\s*\(/gm)) {
      assert.ok(!seen.has(match[1]), `${match[1]} declared in ${seen.get(match[1])} and ${script}`);
      seen.set(match[1], script);
    }
  }
});

test("split scripts contain only top-level function declarations and comments", () => {
  for (const script of splitScripts) {
    const source = readFileSync(path.join(ui, script), "utf8");
    let position = 0;
    while (position < source.length) {
      const trivia = /^(?:\s+|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)/.exec(source.slice(position));
      if (trivia) { position += trivia[0].length; continue; }
      const allowedLets = {
        "library-ui.js": new Set(["favoriteImportVersion"]),
        "video-pages.js": new Set(["pageCountObserver", "activePageCountLookups", "lastPageCountLookupStartedAt", "pageCountLookupTimer", "pageCacheLookupScheduled", "pagesMetaRequestVersion", "pagesMetaStatusBeforeLoad", "pagesModalContext", "pagesModalReturnFocus"]),
      };
      const declaration = /^let\s+([\w$]+)(?:\s*=\s*(?:-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|null|Number\.NEGATIVE_INFINITY))?\s*;/.exec(source.slice(position));
      if (declaration && allowedLets[script]?.has(declaration[1])) {
        position += declaration[0].length;
        continue;
      }
      assert.match(source.slice(position), /^(?:async\s+)?function\s+[\w$]+\s*\(/, `${script}: unexpected top-level code`);
      let end = source.indexOf("}", position);
      for (; end >= 0; end = source.indexOf("}", end + 1)) {
        try { new vm.Script(source.slice(position, end + 1)); break; } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
      assert.ok(end >= 0, `${script}: incomplete function declaration`);
      position = end + 1;
    }
  }
});

function maskCommentsAndStrings(source) {
  const masked = [...source];
  const hide = (index) => { if (source[index] !== "\n" && source[index] !== "\r") masked[index] = " "; };
  const startsRegex = (index) => {
    const before = source.slice(0, index).trimEnd();
    return !before || /[=([{,:;!?&|]$/.test(before) || /\b(?:return|throw|case|yield|await)\s*$/.test(before);
  };
  const stack = [];
  let mode = "code";
  let interpolationDepth = null;

  for (let index = 0; index < source.length;) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "template") {
      if (char === "\\") { hide(index++); if (index < source.length) hide(index++); }
      else if (char === "`") {
        hide(index++);
        ({ mode, interpolationDepth } = stack.pop());
      } else if (char === "$" && next === "{") {
        hide(index++); hide(index++);
        mode = "code";
        interpolationDepth = 0;
      } else hide(index++);
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") hide(index++);
    } else if (char === "/" && next === "*") {
      hide(index++); hide(index++);
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) hide(index++);
      if (index < source.length) { hide(index++); hide(index++); }
    } else if (char === "\"" || char === "'") {
      const quote = char;
      hide(index++);
      while (index < source.length) {
        const current = source[index];
        hide(index++);
        if (current === "\\" && index < source.length) hide(index++);
        else if (current === quote) break;
      }
    } else if (char === "/" && startsRegex(index)) {
      hide(index++);
      let inClass = false;
      while (index < source.length) {
        const current = source[index];
        hide(index++);
        if (current === "\\" && index < source.length) hide(index++);
        else if (current === "[") inClass = true;
        else if (current === "]") inClass = false;
        else if (current === "/" && !inClass) break;
      }
      while (/[a-z]/i.test(source[index] ?? "")) hide(index++);
    } else if (char === "`") {
      stack.push({ mode, interpolationDepth });
      hide(index++);
      mode = "template";
    } else if (interpolationDepth !== null && char === "{") {
      interpolationDepth++;
      index++;
    } else if (interpolationDepth !== null && char === "}") {
      if (interpolationDepth === 0) { hide(index++); mode = "template"; }
      else { interpolationDepth--; index++; }
    } else index++;
  }
  return masked.join("");
}

function findStateWrites(source) {
  const code = maskCommentsAndStrings(source);
  const lines = source.split(/\r?\n/);
  const fieldPath = /\b(playerState|searchState|libraryState|homeState)\s*\.\s*([\w$]+)(?:\s*\.\s*[\w$]+|\s*\[[^\]]*\])*/g;
  const assignment = /^\s*(?:=(?!=|>)|\+=|-=|\*\*?=|\/=|%=|<<=|>>>=|>>=|&&=|\|\|=|\?\?=|&=|\|=|\^=|\+\+|--)/;
  const mutator = /\.\s*(?:push|pop|shift|unshift|splice|sort|reverse|set|add|delete|clear)$/;
  const writes = [];
  for (const match of code.matchAll(fieldPath)) {
    const after = code.slice(match.index + match[0].length);
    const before = code.slice(0, match.index);
    if (!assignment.test(after) && !/(?:\+\+|--)\s*$/.test(before) &&
        !(mutator.test(match[0]) && /^\s*\(/.test(after))) continue;
    const line = code.slice(0, match.index).split("\n").length;
    writes.push({ state: match[1], field: match[2], line, statement: lines[line - 1].trim() });
  }
  return writes;
}

test("state-write scanner recognizes writes and ignores reads and comments", () => {
  for (const operator of ["=", "+=", "-=", "*=", "**=", "/=", "%=", "<<=", ">>=", ">>>=", "&&=", "||=", "??=", "&=", "|=", "^="]) {
    assert.deepEqual(findStateWrites(`playerState.currentIndex ${operator} 1;`).map(({ state, field }) => [state, field]), [["playerState", "currentIndex"]]);
  }
  for (const expression of ["++playerState.currentIndex", "playerState.currentIndex--", "searchState.results[0] = x", "playerState.queue[0].bvid = x"]) {
    assert.equal(findStateWrites(expression).length, 1, expression);
  }
  for (const method of ["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "set", "add", "delete", "clear"]) {
    assert.deepEqual(findStateWrites(`libraryState.disabledPages.${method}(x);`).map(({ state, field }) => [state, field]), [["libraryState", "disabledPages"]]);
  }
  assert.deepEqual(findStateWrites("if (playerState.shuffle) {}\nplayerState.queue.length;\nplayerState.queue[0].bvid;\nplayerState.currentIndex === 1;"), []);
  assert.deepEqual(findStateWrites("// playerState.shuffle = true\n/* libraryState.playlists.push(x) */\n'homeState.mode = 1'"), []);
  assert.deepEqual(findStateWrites("const pattern = /playerState.shuffle = true/;"), []);
  assert.equal(findStateWrites("`value ${searchState.page++}`")[0].field, "page");
  assert.deepEqual(findStateWrites("\nplayerState.queue.push(x)")[0], {
    state: "playerState", field: "queue", line: 2, statement: "playerState.queue.push(x)",
  });
});

test("state fields are written only by approved scripts", () => {
  // A textual scan cannot detect writes through aliases, e.g. const q = playerState.queue; q.push(x).
  const allowedWriters = {
    playerState: new Set(["main.js"]),
    searchState: new Set(["main.js", "search.js"]),
    libraryState: new Set(["main.js", "library-ui.js", "video-pages.js"]),
    homeState: new Set(["main.js", "home.js"]),
  };
  const unexpected = [];
  for (const script of scripts) {
    const source = readFileSync(path.join(ui, script), "utf8");
    for (const write of findStateWrites(source)) {
      if (!allowedWriters[write.state].has(script)) {
        unexpected.push(`${script}:${write.line}: ${write.statement}`);
      }
    }
  }
  assert.equal(unexpected.length, 0, unexpected.join("\n"));
});
