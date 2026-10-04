const { topLevelStatements, maskCommentsAndStrings } = require("./js-source.cjs");
const { stripModuleSyntax } = require("./module-syntax.cjs");

function topLevelNames(source, file = "source.js") {
  const names = new Set();
  for (const statement of topLevelStatements(stripModuleSyntax(source, file))) {
    const name = /^(?:(?:async\s+)?function|class|const|let|var)\s+([\w$]+)/.exec(statement.code);
    if (name) names.add(name[1]);
    else if (/^(?:const|let)\s*\{/.test(statement.code)) {
      const bindings = statement.text.slice(statement.text.indexOf("{") + 1, statement.text.indexOf("}"));
      for (const binding of bindings.split(",")) names.add(binding.split(":").at(-1).trim());
    }
  }
  return names;
}

// Ratchet for current sources; local collisions must be explicitly reviewed by tests.
function references(source, file = "source.js") {
  const code = maskCommentsAndStrings(stripModuleSyntax(source, file));
  const names = new Set();
  for (const match of code.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    const before = code.slice(0, match.index).trimEnd();
    const after = code.slice(match.index + match[0].length);
    if (before.endsWith(".") && !before.endsWith("...")) continue;
    if (/^\s*:/.test(after) && /[{,]$/.test(before)) continue;
    names.add(match[0]);
  }
  return names;
}

module.exports = { topLevelNames, references };
