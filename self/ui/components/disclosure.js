/** Nonmodal disclosure: activation opens; focus alone never does. */
export function bindDisclosure({ root, trigger, panel, closeButton, native = false }) {
  const controller = new AbortController(), options = { signal: controller.signal };
  const isOpen = () => native ? root.open : !panel.hidden;
  const setOpen = (open, { restoreFocus = false } = {}) => {
    if (native) root.open = open;
    else panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (restoreFocus) trigger.focus({ preventScroll: true });
  };
  if (native) root.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(root.open)), options);
  else trigger.addEventListener('click', () => setOpen(!isOpen()), options);
  closeButton?.addEventListener('click', () => setOpen(false, { restoreFocus: true }), options);
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) {
      event.stopPropagation(); setOpen(false, { restoreFocus: true });
    }
  }, options);
  root.ownerDocument.addEventListener('pointerdown', event => {
    if (isOpen() && !root.contains(event.target)) setOpen(false);
  }, options);
  setOpen(isOpen());
  return { setOpen, dispose: () => controller.abort() };
}
