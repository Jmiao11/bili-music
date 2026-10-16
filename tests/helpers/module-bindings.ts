import { topLevelStatements, maskCommentsAndStrings } from "./js-source.ts";
import { stripModuleSyntax } from "./module-syntax.ts";

function topLevelNames(source: string, file = "source.js") {
  const names = new Set<string>();
  for (const statement of topLevelStatements(stripModuleSyntax(source, file))) {
    const name = /^(?:(?:async\s+)?function|class|const|let|var)\s+([\w$]+)/.exec(statement.code);
    if (name) names.add(name[1]);
    else if (/^(?:const|let)\s*\{/.test(statement.code)) {
      const bindings = statement.text.slice(statement.text.indexOf("{") + 1, statement.text.indexOf("}"));
      for (const binding of bindings.split(",")) {
        const name = binding.split(":").at(-1);
        if (name === undefined) throw new Error("Destructuring binding has no name");
        names.add(name.trim());
      }
    }
  }
  return names;
}

// Find fixture references outside comments and strings.
function references(source: string, file = "source.js") {
  const code = maskCommentsAndStrings(stripModuleSyntax(source, file));
  const names = new Set<string>();
  for (const match of code.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    const before = code.slice(0, match.index).trimEnd();
    const after = code.slice(match.index + match[0].length);
    if (before.endsWith(".") && !before.endsWith("...")) continue;
    if (/^\s*:/.test(after) && /[{,]$/.test(before)) continue;
    names.add(match[0]);
  }
  return names;
}

export { topLevelNames, references };

export type Contract = { topLevelNames: typeof topLevelNames; references: typeof references };
