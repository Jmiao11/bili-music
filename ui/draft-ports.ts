import { homeHintInput, searchKeyword } from "./player-dom.ts";
function readSearchDraft(): string { return searchKeyword.value; }
function writeSearchDraft(value: string): void { searchKeyword.value = value; }
function readHomeHintDraft(): string { return homeHintInput?.value ?? ""; }
function writeHomeHintDraft(value: string): void { if (homeHintInput) homeHintInput.value = value; }
function readAiKeyDraft(): string { return document.querySelector<HTMLInputElement>("#ai-api-key-input")?.value ?? ""; }
function clearAiKeyDraft(): void { const input = document.querySelector<HTMLInputElement>("#ai-api-key-input"); if (input) input.value = ""; }

export {clearAiKeyDraft, readAiKeyDraft, readHomeHintDraft, readSearchDraft, writeHomeHintDraft, writeSearchDraft};
