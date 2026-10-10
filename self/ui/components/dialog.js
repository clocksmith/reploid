/** Native dialog owns modal focus containment and Escape; restore its opener on close. */
export function bindDialog(dialog) {
  const controller = new AbortController();
  let opener;
  const closed = () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
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
