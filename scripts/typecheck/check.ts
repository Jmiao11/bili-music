import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type Diagnostic = { file: string; code: number; message: string };
function parseDiagnostics(output: string, root: string) {
  const diagnostics: Diagnostic[] = [];
  for (const line of output.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const match = /^(.*)\(\d+,\d+\): error TS(\d+): (.+)$/.exec(line);
    if (match) {
      const paths = /^[A-Za-z]:[\\/]/.test(root) ? path.win32 : path.posix;
      const file = paths.resolve(root, match[1]);
      const relative = paths.relative(root, file).replace(/\\/g, "/");
      if (relative.startsWith("../") || paths.isAbsolute(relative)) throw new Error(`Diagnostic outside repository: ${match[1]}`);
      diagnostics.push({ file: relative, code: Number(match[2]), message: match[3] });
    } else if (/^\s+\S/.test(line) && diagnostics.length) {
      diagnostics[diagnostics.length - 1].message += ` ${line.trim()}`;
    } else {
      throw new Error(`Unparseable tsc output: ${line}`);
    }
  }
  return diagnostics.map((diagnostic) => ({ ...diagnostic, message: diagnostic.message.replace(/\s+/g, " ").trim() }));
}

function diagnosticCounts(diagnostics: Diagnostic[]) {
  const counts: Record<string, number> = Object.create(null);
  for (const { file, code, message } of diagnostics) {
    const key = `${file} TS${code}: ${message}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, "en")));
}

function compareCounts(actual: Record<string, number>, baseline: Record<string, number>, update = false) {
  const errors = [];
  for (const key of new Set([...Object.keys(actual), ...Object.keys(baseline)])) {
    const current = actual[key] || 0;
    const previous = baseline[key] || 0;
    if (current > previous) errors.push(`New/increased diagnostic (${previous} -> ${current}): ${key}`);
    if (!update && current < previous) errors.push(`Reduced diagnostic (${previous} -> ${current}); run npm run typecheck -- --update: ${key}`);
  }
  return errors;
}

function run() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || !["--update", "--rebaseline"].includes(args[0]))) throw new Error("Usage: npm run typecheck [-- --update | --rebaseline]");
  const update = args[0] === "--update";
  // Manual, explicitly authorized baseline replacement; never used by CI.
  const rebaseline = args[0] === "--rebaseline";
  const root = path.resolve(import.meta.dirname, "../..");
  const baselineFile = path.join(import.meta.dirname, "diagnostics.json");
  const baseline: Record<string, number> = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  if (!baseline || Array.isArray(baseline) || typeof baseline !== "object" || Object.entries(baseline).some(([key, count]) => !key || !Number.isSafeInteger(count) || count < 1)) throw new Error("Invalid diagnostic baseline");
  const all: Diagnostic[] = [];

  for (const project of ["main", "mini", "node"]) {
    const executable = path.join(root, project === "main" ? "node_modules/vue-tsc/bin/vue-tsc.js" : "node_modules/typescript/bin/tsc");
    const config = path.join(import.meta.dirname, `tsconfig.${project}.json`);
    fs.accessSync(config);
    const result = spawnSync(process.execPath, [executable, "-p", config, "--pretty", "false"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.signal || !([0, 1, 2] as (number | null)[]).includes(result.status) || result.stderr.trim()) throw new Error(`tsc ${project} failed: ${result.error || result.signal || result.stderr || result.stdout || result.status}`);
    const diagnostics = parseDiagnostics(result.stdout, root);
    if (project === "node" && diagnostics.length) throw new Error(`Node tool diagnostics must be fixed, not baselined: ${JSON.stringify(diagnostics)}`);
    if (diagnostics.some(({ file }) => !file.startsWith("ui/"))) throw new Error(`Contract/declaration diagnostics must be fixed, not baselined: ${JSON.stringify(diagnostics.filter(({ file }) => !file.startsWith("ui/")))}`);
    if ((result.status === 0) !== (diagnostics.length === 0)) throw new Error(`tsc ${project} exit status does not match diagnostics`);
    all.push(...diagnostics);
    const codes = diagnosticCountsByCode(diagnostics);
    console.log(`${project}: ${diagnostics.length} diagnostics ${JSON.stringify(codes)}`);
  }
  const actual = diagnosticCounts(all);
  if (all.length) throw new Error(`Type checks require zero diagnostics: ${JSON.stringify(actual)}`);
  const errors = rebaseline ? [] : compareCounts(actual, baseline, update);
  if (errors.length) throw new Error(errors.join("\n"));
  if (update || rebaseline) fs.writeFileSync(baselineFile, JSON.stringify(actual, null, 2) + "\n");
  console.log(rebaseline ? "Diagnostic baseline rebuilt explicitly." : update ? "Diagnostic baseline reduced/unchanged." : "Diagnostic baseline matches.");
}

function diagnosticCountsByCode(diagnostics: Diagnostic[]) {
  const result: Record<string, number> = {};
  for (const { code } of diagnostics) result[`TS${code}`] = (result[`TS${code}`] || 0) + 1;
  return result;
}

export { parseDiagnostics, diagnosticCounts, compareCounts };
if (import.meta.main) {
  try { run(); } catch (error) { console.error((error as { message?: unknown }).message); process.exitCode = 1; }
}

export type Contract = { parseDiagnostics: typeof parseDiagnostics; diagnosticCounts: typeof diagnosticCounts; compareCounts: typeof compareCounts };
