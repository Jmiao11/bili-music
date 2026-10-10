import path from "node:path";
import { spawnSync } from "node:child_process";
import { testGroups } from "./groups.ts";

const root = path.resolve(import.meta.dirname, "../..");
const result = spawnSync(process.execPath, ["--test", ...testGroups(root).after], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
