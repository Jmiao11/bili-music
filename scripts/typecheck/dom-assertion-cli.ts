import path from "node:path";
import { checkRepository, checkEsmSources } from "./dom-assertions.ts";
import { renderApplicationHtml } from "../vue/shell-html.ts";

const root = path.resolve(import.meta.dirname, "../..");
try {
  checkRepository(root, await renderApplicationHtml(root));
  checkEsmSources(root);
} catch (error) {
  console.error((error as { message?: unknown }).message);
  process.exitCode = 1;
}
