import fs from "node:fs";
import path from "node:path";
import { stripTypes } from "../tests/helpers/typescript-source.ts";

const ui = path.join(import.meta.dirname, "../ui");
for (const entry of fs.readdirSync(ui, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".ts")) {
    const file = path.join(ui, entry.name);
    stripTypes(fs.readFileSync(file, "utf8"), file);
  }
}
