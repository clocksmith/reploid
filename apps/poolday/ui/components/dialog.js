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
  // A header Close and any in-app destination (a fix that opens Computers or Settings) close the dialog.
  dialog.addEventListener('click', event => {
    if (event.target.closest?.('[data-dialog-close], a[data-workspace-view]')) dialog.close();
  }, { signal: controller.signal });
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
