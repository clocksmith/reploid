import { describe, it, expect } from 'vitest';
import { renderDiamond, bindDiamond } from '../../self/ui/components/diamond.js';
describe('Diamond progress component', () => {
  it('keeps multiple SVG gradient references independent', () => {
    const root = document.createElement('div'); root.innerHTML = renderDiamond() + renderDiamond();
    const ids = [...root.querySelectorAll('[id]')].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => renderDiamond({ id: '"><script>' })).toThrow();
  });
  it('distinguishes unknown progress, measured completion and cleanup', () => {
    const root = document.createElement('div'); root.innerHTML = renderDiamond();
    const shell = root.firstElementChild, view = bindDiamond(shell, { state: 'loading', label: 'Loading model' });
    expect(shell.getAttribute('aria-valuenow')).toBeNull();
    view.update({ state: 'progress', progress: 0.42 }); expect(shell.getAttribute('aria-valuenow')).toBe('42');
    expect(() => view.update({ progress: NaN })).toThrow();
    view.update({ state: 'complete' }); expect(shell.getAttribute('aria-valuenow')).toBe('100');
    view.dispose(); expect(shell.dataset.diamondState).toBe('idle'); expect(shell.getAttribute('role')).toBeNull();
    view.update({ state: 'loading' }); expect(shell.dataset.diamondState).toBe('idle');
  });
});
