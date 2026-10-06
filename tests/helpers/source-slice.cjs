const { isTypeScript, eraseTypes } = require("./typescript-source.cjs");

function sourceSlice(source, file, startMarker, endMarker, {
  endAfterStart = false,
  startLastBefore = null,
  includeEnd = false,
  stripModules = true,
} = {}) {
  const erased = eraseTypes(source, file);
  if (isTypeScript(file) && stripModules) {
    source = require("./module-syntax.cjs").stripModuleSyntax(source, file);
  } else {
    source = erased;
  }
  const find = (marker, from = 0) => {
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
