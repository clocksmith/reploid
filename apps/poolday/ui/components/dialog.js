/** Native dialog owns modal focus containment and Escape; restore its opener on close. */
export function bindDialog(dialog) {
  const controller = new AbortController();
  let opener;
  const closed = () => {
    const active = dialog.ownerDocument.activeElement;
    // Native close already restores focus. Do not steal a later deliberate focus change.
    if (opener?.isConnected && (active === dialog.ownerDocument.body || dialog.contains(active))) opener.focus({ preventScroll: true });
  };
  dialog.addEventListener('close', closed, { signal: controller.signal });
  return {
    open(focusTarget, returnFocus = dialog.ownerDocument.activeElement) {
      if (dialog.open) return;
      opener = returnFocus;
      dialog.showModal();
      focusTarget?.focus();
    },
    close: () => dialog.close(),
    dispose() { controller.abort(); if (dialog.open) dialog.close(); }
  };
}
