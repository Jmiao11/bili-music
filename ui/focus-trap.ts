function trapFocus(event: KeyboardEvent, host: HTMLElement): void {
  if (event.key !== "Tab" || !host.classList.contains("is-open")) return;
  const focusable = [...host.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])')].filter(element => !element.closest("[hidden]"));
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && host.ownerDocument.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && host.ownerDocument.activeElement === last) { event.preventDefault(); first.focus(); }
}

export { trapFocus };
