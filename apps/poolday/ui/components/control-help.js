import { bindDialog } from './dialog.js';
import { interfaceIcon } from './interface-icons.js';

export const renderHelpButton = () => `<button class="pool-button btn-ghost pool-icon" type="button" data-open-control-help aria-label="Help" title="Help" aria-haspopup="dialog">${interfaceIcon('help')}</button>`;
export const renderControlHelp = () => `${renderHelpButton()}<dialog class="chat-model-setup pool-surface pool-small" data-control-help aria-labelledby="chat-help-title">
  <header class="chat-network-heading"><h2 class="pool-heading" id="chat-help-title">Help</h2><button class="pool-button btn-ghost" type="button" data-close-control-help>Close</button></header>
  <dl class="pool-stack pool-gap-sm">
    <div><dt>Model</dt><dd>Choose who answers. Shared uses another computer; This device runs locally. Ready models can answer now. Model details shows providers and execution choices.</dd></div>
    <div><dt>Files</dt><dd>Attach text files to include them with your question. Sending to a shared model also sends that request’s contents to its computer.</dd></div>
    <div><dt>Search</dt><dd>Search the web for this answer. Turn it off to ask without web search.</dd></div>
    <div><dt>Context</dt><dd>The ring shows how much conversation space is used. Tap it to inspect context and execution details.</dd></div>
    <div><dt>Progress and Stop</dt><dd>The animated status beside an answer shows its current stage. Tap it for details. Stop cancels that answer; any partial text stays.</dd></div>
    <div><dt>Measurements</dt><dd>Tap an answer’s speed, token count or time for its explanation. Missing measurements remain blank.</dd></div>
  </dl></dialog>`;

let serial = 0;
/** Shared hover/focus help; read-only measurements also open on tap. Action taps keep their action. */
export function bindControlHelp(root) {
  const controller = new AbortController(), options = { signal: controller.signal };
  const doc = root.ownerDocument, tip = doc.createElement('div');
  tip.id = `control-help-${++serial}`; tip.className = 'pool-tooltip pool-surface pool-small';
  tip.setAttribute('role', 'tooltip'); tip.setAttribute('popover', 'manual'); tip.hidden = true;
  let target = null, title = '', description = null, timer = null;
  const hide = () => {
    clearTimeout(timer);
    if (target) {
      if (!target.title) target.title = title;
      if (description === null) target.removeAttribute('aria-describedby'); else target.setAttribute('aria-describedby', description);
    }
    target = null;
    if (tip.matches(':popover-open')) tip.hidePopover();
    tip.hidden = true;
  };
  const show = element => {
    if (!element || !root.contains(element) || element === target) return;
    const text = element.dataset.help || element.title;
    if (!text) return;
    hide(); target = element; title = element.title; description = element.getAttribute('aria-describedby');
    element.removeAttribute('title'); element.setAttribute('aria-describedby', [description, tip.id].filter(Boolean).join(' '));
    tip.textContent = text; (element.closest('dialog[open]') || root).append(tip); tip.hidden = false;
    tip.showPopover?.();
    const box = element.getBoundingClientRect(), width = tip.getBoundingClientRect().width, height = tip.getBoundingClientRect().height;
    const viewport = doc.defaultView;
    tip.style.setProperty('--pool-param-help-left', `${Math.max(8, Math.min(box.left, viewport.innerWidth - width - 8))}px`);
    tip.style.setProperty('--pool-param-help-top', `${Math.max(8, box.top >= height + 16 ? box.top - height - 8 : Math.min(box.bottom + 8, viewport.innerHeight - height - 8))}px`);
  };
  const eligible = event => event.target.closest?.('[data-help],button[title],a[title],label[title],[tabindex][title]');
  root.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const element = eligible(event);
    if (element || target?.contains(event.target)) { clearTimeout(timer); show(element); }
  }, options);
  // A tooltip must remain readable under the pointer without intercepting controls beneath it.
  doc.addEventListener('pointermove', event => {
    if (!target || tip.hidden) return;
    const box = tip.getBoundingClientRect();
    if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) clearTimeout(timer);
    else if (!target.contains(event.target) && !target.contains(doc.activeElement)) { clearTimeout(timer); timer = setTimeout(hide, 150); }
  }, options);
  root.addEventListener('pointerout', event => {
    if (target && !target.contains(doc.activeElement) && !target.contains(event.relatedTarget) && !tip.contains(event.relatedTarget)) timer = setTimeout(hide, 150);
  }, options);
  root.addEventListener('focusin', event => show(eligible(event)), options);
  root.addEventListener('focusout', event => { if (target?.contains(event.target)) hide(); }, options);
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && target) { hide(); event.preventDefault(); event.stopPropagation(); }
  }, { ...options, capture: true });
  const dialogNode = root.querySelector('[data-control-help]');
  const dialog = dialogNode && bindDialog(dialogNode);
  root.addEventListener('click', event => {
    const help = event.target.closest('[data-open-control-help]');
    if (help && dialog) { hide(); dialog.open(dialogNode.querySelector('[data-close-control-help]'), help); }
    else if (event.target.closest('[data-close-control-help]')) dialog?.close();
    else if (event.target.closest('.chat-message-metric')) show(event.target.closest('.chat-message-metric'));
    else hide();
  }, options);
  root.addEventListener('scroll', hide, { ...options, capture: true });
  doc.defaultView.addEventListener('resize', hide, options);
  return () => { hide(); controller.abort(); dialog?.dispose(); tip.remove(); };
}
