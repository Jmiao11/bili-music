const { isTypeScript, eraseTypes }: import("./typescript-source.cts").Contract = require("./typescript-source.cts");

function sourceSlice(source: string, file: string, startMarker: string | null, endMarker: string, {
  endAfterStart = false,
  startLastBefore = null,
  includeEnd = false,
  stripModules = true,
}: { endAfterStart?: boolean; startLastBefore?: string | null; includeEnd?: boolean; stripModules?: boolean } = {}) {
  const erased = eraseTypes(source, file);
  if (isTypeScript(file) && stripModules) {
    source = require("./module-syntax.cts").stripModuleSyntax(source, file);
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
  return source.slice(start, end + (includeEnd ? endMarker.length : 0));
}

module.exports = { sourceSlice };

export type Contract = { sourceSlice: typeof sourceSlice };
