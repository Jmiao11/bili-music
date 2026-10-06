import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { scripts, stylesheets, replaceAttribute, ordinarySource } from "./preserve-html.mts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ui = path.join(root, "ui");
const configFile = path.join(root, "vite.config.mts");
const pages = ["index.html", "mini.html"];
const { loadNativeModules }: { loadNativeModules(root: string, files: string[], entry: string, order: { file: string; module: boolean }[]): Promise<{ events: { stack?: string; action: string; type?: string }[] }> } = createRequire(import.meta.url)("../../tests/helpers/native-module-loader.cts");
const tempParent = path.join(os.tmpdir(), "bili-music-verify");
fs.mkdirSync(tempParent, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempParent, "vite-dist-"));
const output = path.join(temp, "windows");
const sourceHtml = (page: string) => fs.readFileSync(path.join(ui, page), "utf8");

async function checkPlatformBuilds() {
  const originalPlatform = process.env.TAURI_ENV_PLATFORM;
  const darwin = path.join(temp, "darwin");
  try {
    for (const [platform, outDir] of [["windows", output], ["darwin", darwin]]) {
      process.env.TAURI_ENV_PLATFORM = platform;
      await build({ configFile, build: { outDir, emptyOutDir: true } });
    }
  } finally {
    if (originalPlatform === undefined) delete process.env.TAURI_ENV_PLATFORM;
    else process.env.TAURI_ENV_PLATFORM = originalPlatform;
  }
  const files = (directory: string) => (fs.readdirSync(directory, { recursive: true }) as string[]).filter((file) => /\.(?:js|html|css)$/.test(file)).sort();
  const windowsFiles = files(output);
  assert.deepEqual(files(darwin), windowsFiles, "Windows/darwin JS/HTML/CSS file inventories differ");
  for (const file of windowsFiles) {
    assert.deepEqual(fs.readFileSync(path.join(output, file)), fs.readFileSync(path.join(darwin, file)),
      `Windows/darwin bytes differ: ${file}`);
  }
  console.log(`PASS PLATFORM: windows/darwin ${windowsFiles.length} JS/HTML/CSS files byte-identical`);
}

function localFile(directory: string, reference: string) {
  const file = path.resolve(directory, decodeURIComponent(reference.split(/[?#]/)[0]));
  const relative = path.relative(directory, file);
  assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative), `Reference outside output: ${reference}`);
  return file;
}

function checkPage(page: string) {
  const source = sourceHtml(page);
  const html = fs.readFileSync(path.join(output, page), "utf8");
  assert.ok(!html.includes("/@vite/client"), `${page}: dev client in production`);
  for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
    for (const reference of tag[0].matchAll(/\b(?:src|href|poster)\s*=\s*(["'])(.*?)\1/gi)) {
      if (!reference[2] || /^(?:#|[a-z][a-z\d+.-]*:|\/\/)/i.test(reference[2])) continue;
      assert.ok(fs.existsSync(localFile(output, reference[2])), `Missing HTML reference: ${page} -> ${reference[2]}`);
    }
  }
  const originals = scripts(source);
  const generated = scripts(html);
  assert.equal(generated.length, originals.length, `${page}: script count changed`);
  let expected = source;
  originals.forEach((script, index) => {
    const built = generated[index];
    if (script.module) {
      assert.ok(built.module && built.src, `${page}: module tag position/type changed`);
      expected = expected.replace(script.tag, replaceAttribute(script.tag, "src", built.src));
    } else {
      assert.equal(built.tag, script.tag, `${page}: ordinary/inline script changed at index ${index}`);
      if (script.src) {
        assert.deepEqual(fs.readFileSync(localFile(output, script.src)), ordinarySource(localFile(ui, script.src)),
          `${page}: ordinary script bytes changed: ${script.src}`);
      }
    }
  });
  const sourceCss = stylesheets(source);
  const builtCss = stylesheets(html);
  assert.equal(builtCss.length, sourceCss.length, `${page}: CSS link count changed`);
  sourceCss.forEach((link, index) => {
    const builtHref = builtCss[index].href;
    if (builtHref === undefined) throw new Error(`${page}: built stylesheet href is missing`);
    if (link.href === undefined) throw new Error(`${page}: source stylesheet href is missing`);
    expected = expected.replace(link.tag, replaceAttribute(link.tag, "href", builtHref));
    const normalize = (text: string) => text.replace(/\r\n/g, "\n").trim();
    assert.equal(normalize(fs.readFileSync(localFile(output, builtHref), "utf8")),
      normalize(fs.readFileSync(localFile(ui, link.href), "utf8")), `${page}: CSS differs from source`);
  });
  // Exact whole-document comparison also protects head/body location, all attributes and inline whitespace.
  assert.equal(html, expected, `${page}: HTML changed beyond module src and CSS href`);
}

async function checkStartup() {
  const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
  const order = scripts(html).filter((script): script is typeof script & { src: string } => Boolean(script.src)).map((script) => ({
    file: path.relative(output, localFile(output, script.src)).split(path.sep).join("/"), module: script.module,
  }));
  const files = (fs.readdirSync(output, { recursive: true }) as string[]).filter((file) => file.endsWith(".js"));
  const entry = order.find((script) => script.module);
  if (entry === undefined) throw new Error("Production module entry is missing");
  const loaded = await loadNativeModules(output, files, entry.file, order);
  const sequence = loaded.events.map(({ stack, ...event }) => event);
  const firstTrackchange = sequence.findIndex((event) => event.action === "dispatch" && event.type === "bilibili-music-trackchange");
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/playback-startup-installation.json"), "utf8"));
  assert.deepEqual({ sequence, firstTrackchange }, snapshot, "Production startup differs from G0");
  console.log(`PASS G0: ${sequence.length} records; first trackchange index ${firstTrackchange}`);
}

function checkCounterexamples() {
  const ordinary = scripts(sourceHtml("index.html")).find((script) => script.src && !script.module);
  if (ordinary === undefined || ordinary.src === undefined) throw new Error("Counterexample ordinary script entry is missing");
  const file = localFile(output, ordinary.src);
  const bytes = fs.readFileSync(file);
  fs.unlinkSync(file);
  try {
    assert.throws(() => checkPage("index.html"), (error: Error) => {
      assert.match(error.message, /Missing HTML reference/);
      console.log(`PASS counterexample missing ordinary script: ${error.message}`);
      return true;
    });
  } finally { fs.writeFileSync(file, bytes); }

  const htmlFile = path.join(output, "index.html");
  const html = fs.readFileSync(htmlFile, "utf8");
  const order = scripts(html);
  const moduleIndex = order.findIndex((script) => script.module);
  const previous = order[moduleIndex - 1].tag;
  const entry = order[moduleIndex].tag;
  const incorrect = html.replace(entry, "").replace(previous, `${entry}\n    ${previous}`);
  fs.writeFileSync(htmlFile, incorrect);
  try {
    assert.throws(() => checkPage("index.html"), (error: Error) => {
      assert.match(error.message, /ordinary\/inline script changed|module tag position/);
      console.log(`PASS counterexample misplaced module tag: ${error.message.split("\n")[0]}`);
      return true;
    });
  } finally { fs.writeFileSync(htmlFile, html); }
}

async function checkDevelopment() {
  const server = await createServer({ configFile, server: { port: 0, host: "127.0.0.1", hmr: undefined } });
  try {
    await server.listen();
    if (server.httpServer === null) throw new Error("Development HTTP server is missing");
    const address = server.httpServer.address();
    if (address === null || typeof address === "string") throw new Error("Development HTTP server has no TCP listening address");
    const port = address.port;
    for (const page of pages) {
      const response = await fetch(`http://127.0.0.1:${port}/${page}`);
      assert.equal(response.status, 200, `${page}: dev HTTP status`);
      const html = await response.text();
      const client = '<script type="module" src="/@vite/client"></script>';
      assert.equal(scripts(html).filter((script) => script.src === "/@vite/client").length, 1, `${page}: dev client count`);
      for (const script of scripts(sourceHtml(page)).filter((item): item is typeof item & { src: string } => Boolean(item.src) && !item.module)) {
        const file = localFile(ui, script.src);
        if (fs.existsSync(file)) continue;
        const url = script.src.replace(/^\.\//, "");
        const ordinary = await fetch(`http://127.0.0.1:${port}/${url}`);
        assert.equal(ordinary.status, 200);
        const contentType = ordinary.headers.get("content-type");
        if (contentType === null) throw new Error(`${page}: ordinary script Content-Type is missing`);
        assert.match(contentType, /(?:application|text)\/javascript/);
        assert.deepEqual(Buffer.from(await ordinary.arrayBuffer()), ordinarySource(file), `${page}: dev erasure bytes changed: ${script.src}`);
        console.log(`PASS DEV ordinary ${url}: JavaScript MIME and exact erased bytes`);
      }
      let expected = sourceHtml(page);
      // Vite 8.3.2 normalizes these index URLs on an actual /index.html request; mini URLs stay relative.
      // Keep the list explicit and log every rewrite: any other HTML change must fail.
      if (page === "index.html") {
        const rewrites = [
          ["href", "./styles.css", "/styles.css"],
          ["src", "./sidebar.js", "/sidebar.js"],
          ["src", "./window-controls.js", "/window-controls.js"],
          ["src", "./dynamic-background.js", "/dynamic-background.js"],
          ["src", "app.ts", "/app.ts"],
          ["src", "./lyrics.js", "/lyrics.js"],
          ["src", "./mascot.js", "/mascot.js"],
          ["src", "./mini-player-host.js", "/mini-player-host.js"],
        ];
        for (const [name, before, after] of rewrites) {
          const token = `${name}="${before}"`;
          assert.equal(expected.split(token).length, 2, `Expected exactly one ${token}`);
          expected = expected.replace(token, `${name}="${after}"`);
          console.log(`DEV rewrite ${page}: ${name} ${before} -> ${after}`);
        }
      }
      // Only the injected tag's own LF/indentation is allowed; original CRLF and business script bodies stay exact.
      expected = expected.replace("<head>", `<head>\n    ${client}\n`);
      assert.equal(html, expected, `${page}: unexpected development HTML rewrite`);
      console.log(`PASS DEV ${page}: one client tag; otherwise only the listed URL rewrites`);
    }
  } finally { await server.close(); }
}

try {
  await checkPlatformBuilds();
  for (const page of pages) { checkPage(page); console.log(`PASS DIST ${page}: HTML, references, ordinary bytes, CSS`); }
  await checkStartup();
  checkCounterexamples();
  await checkDevelopment();
} finally {
  assert.equal(path.dirname(temp), tempParent);
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log("PASS verify:dist (temporary build removed; dev server closed)");
