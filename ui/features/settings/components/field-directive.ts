import type {SettingsControl} from "../settings-controls.ts";
// A value write is explicit; unrelated attribute updates must preserve native drafts.
function applySettingsField(element: { value: string; checked?: boolean }, value: SettingsControl, previous?: SettingsControl): void {
  if (value.valueVersion && value.valueVersion !== previous?.valueVersion) element.value = value.value ?? "";
  if (value.checkedVersion && value.checkedVersion !== previous?.checkedVersion) element.checked = value.checked ?? false;
}
export {applySettingsField};
