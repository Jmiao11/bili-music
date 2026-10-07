import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { stripTypes }: import("../tests/helpers/typescript-source.cts").Contract = createRequire(import.meta.url)("../tests/helpers/typescript-source.cts");

const ui = path.join(import.meta.dirname, "../ui");
for (const entry of fs.readdirSync(ui, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".ts")) {
    const file = path.join(ui, entry.name);
    stripTypes(fs.readFileSync(file, "utf8"), file);
  }
}
