/** One reversible slide. A closing drawer is inert until its visual retirement settles. */
export function bindDrawer(node, { side, markRoot = node.querySelector('[data-drawer-mark]'), onSettled = () => {} } = {}) {
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const direction = side === 'left' ? -1 : 1;
  let opened = false, revision = 0, slide = null, marks = [], disposed = false;
  node.dataset.drawerSide = side; node.hidden = true; node.inert = true;
  const settle = () => { node.hidden = !opened; node.inert = !opened; delete node.dataset.drawerMoving; onSettled(opened); };
  const cancel = () => { slide?.cancel(); slide = null; marks.forEach(animation => animation.cancel()); marks = []; };
  const setOpen = next => {
    if (disposed || next === opened) return;
    const current = ++revision, wasHidden = node.hidden;
    const initial = wasHidden ? `translateX(${direction * 110}%)` : getComputedStyle(node).transform;
    const glyphs = [...(markRoot?.querySelectorAll('.pool-seven-main, .pool-seven-small') || [])];
    const previous = glyphs.map(glyph => getComputedStyle(glyph).transform);
    cancel(); opened = next; node.hidden = false; node.inert = !next;
    node.dataset.drawerMoving = next ? 'opening' : 'closing';
    const style = getComputedStyle(node), duration = parseFloat(style.getPropertyValue('--pool-motion-drawer-duration'));
    if (reduced?.matches || !node.animate || !Number.isFinite(duration)) { settle(); return; }
    const timing = { duration, easing: style.getPropertyValue('--pool-motion-nav-easing').trim(), fill: 'both' };
    slide = node.animate([{ transform: initial === 'none' ? 'translateX(0)' : initial },
      { transform: next ? 'translateX(0)' : `translateX(${direction * 110}%)` }], timing);
    const travel = parseFloat(style.getPropertyValue('--pool-size-12')), rise = parseFloat(style.getPropertyValue('--pool-size-8'));
    glyphs.forEach((glyph, index) => {
      const base = getComputedStyle(glyph).transform, sign = direction * (next ? -1 : 1) * (index ? -1 : 1);
      marks.push(glyph.animate([{ transform: wasHidden ? base : previous[index] },
        { transform: `translate(${sign * travel}px, ${index ? rise : -rise}px) scale(${index ? 1.15 : .85})`, offset: .4 },
        { transform: base }], timing));
    });
    slide.finished.then(() => { if (current === revision && !disposed) { cancel(); settle(); } }).catch(() => {});
  };
  const preference = () => { if (reduced.matches) { revision++; cancel(); settle(); } };
  reduced?.addEventListener('change', preference);
  return { setOpen, isOpen: () => opened, dispose() { disposed = true; revision++; cancel(); opened = false; settle(); reduced?.removeEventListener('change', preference); } };
}
