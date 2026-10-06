const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const { stripTypes }: import("../tests/helpers/typescript-source.cts").Contract = require("../tests/helpers/typescript-source.cts");

const ui = path.join(__dirname, "../ui");
for (const entry of fs.readdirSync(ui, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".ts")) {
    const file = path.join(ui, entry.name);
    stripTypes(fs.readFileSync(file, "utf8"), file);
  }
}
