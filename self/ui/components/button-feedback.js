/** Delegated feedback works for dynamically mounted catalog and product controls. */
export function bindButtonFeedback(root) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), ripples = new Set();
  const find = event => {
    const button = event.target.closest?.('.pool-button, .pool-work-shell .btn');
    return button && root.contains(button) && !button.matches(':disabled, [aria-disabled="true"]') ? button : null;
  };
  const origin = (button, x, y) => {
    const box = button.getBoundingClientRect();
    button.style.setProperty('--pool-param-pointer-x', `${100 * x / box.width}%`);
    button.style.setProperty('--pool-param-pointer-y', `${100 * y / box.height}%`);
    return box;
  };
  const hover = event => {
    if (event.pointerType === 'touch') return;
    const button = find(event); if (!button || button.contains(event.relatedTarget)) return;
    const box = button.getBoundingClientRect(); origin(button, event.clientX - box.left, event.clientY - box.top);
  };
  const press = event => {
    const button = find(event); if (!button) return;
    const keyboard = event.type === 'keydown';
    if (keyboard && (!['Enter', ' '].includes(event.key) || event.repeat)) return;
    if (!keyboard && event.button !== 0) return;
    const box = button.getBoundingClientRect();
    const x = keyboard ? box.width / 2 : event.clientX - box.left, y = keyboard ? box.height / 2 : event.clientY - box.top;
    origin(button, x, y);
    if (reduced.matches || button.tagName === 'INPUT') return;
    const ripple = document.createElement('span'); ripple.className = 'pool-button-ripple'; ripple.setAttribute('aria-hidden', 'true');
    ripple.style.setProperty('--pool-param-ripple-size', `${Math.hypot(box.width, box.height) * 2.2}px`);
    ripple.style.setProperty('--pool-param-ripple-x', `${x}px`); ripple.style.setProperty('--pool-param-ripple-y', `${y}px`);
    button.append(ripple); ripples.add(ripple);
    const animation = ripple.animate([{ transform: 'scale(.05)', opacity: .9 }, { transform: 'scale(1)', opacity: 0 }], { duration: 325, easing: 'cubic-bezier(.16,1,.3,1)' });
    const remove = () => { ripple.remove(); ripples.delete(ripple); };
    animation.onfinish = animation.oncancel = remove;
  };
  root.addEventListener('pointerover', hover); root.addEventListener('pointerdown', press); root.addEventListener('keydown', press);
  return () => {
    root.removeEventListener('pointerover', hover); root.removeEventListener('pointerdown', press); root.removeEventListener('keydown', press);
    for (const ripple of ripples) { ripple.getAnimations().forEach(animation => animation.cancel()); ripple.remove(); }
    ripples.clear();
  };
}
