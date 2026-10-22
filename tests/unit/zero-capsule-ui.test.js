import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountZero } from '../../self/zero/ui.js';

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(overrides = {}) {
  document.body.innerHTML = '<main id="app"></main>';
  document.head.innerHTML = '<style id="zero-capsule-style"></style>';
  const agent = { run: vi.fn(async () => ({ status: 'completed' })), stop: vi.fn(async () => {}), ...overrides };
  const exportSource = vi.fn(async () => ({ schema: 'reploid.zero.image/v1' }));
  const ui = mountZero(document.querySelector('main'), { agent, exportSource,
    config: { provider: 'external', maxIterations: 12 }, source: { files: [1, 2] }, restored: { rejected: [] } });
  const render = (status, messages = [], error = null) => ui.render({ status, messages, error });
  render('idle');
  return { ui, agent, render, exportSource, prompt: document.querySelector('textarea'),
    form: document.querySelector('form'), buttons: [...document.querySelectorAll('button')] };
}
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); document.head.replaceChildren(); });

describe('compact Zero conversation surface', () => {
  it('keeps conversation and prompt visible, with tool code and source details collapsed', () => {
    const { render, prompt } = setup();
    render('completed', [{ role: 'user', content: '<script>bad()</script>' },
      { role: 'assistant', content: 'Built the fixture.' }, { role: 'tool', name: 'Echo', content: 'raw result' }]);
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('[role=log]').textContent).toContain('<script>bad()</script>');
    expect([...document.querySelectorAll('details')].every(node => !node.open)).toBe(true);
    expect(document.querySelector('label').htmlFor).toBe(prompt.id);
    expect(document.querySelector('.zero-capsule > details').textContent).toContain('Connected agent');
    expect(document.body.textContent).toContain('not arbitrary-code isolation');
  });

  it('applies only the current state and preserves stop/error controls across transitions', () => {
    const { render, buttons } = setup();
    for (const state of ['thinking', 'running', 'stopping', 'stopped', 'error', 'idle', 'completed', 'disposed']) {
      render(state, [], state === 'error' ? 'Verifier unavailable' : null);
      expect(document.querySelector('[role=status]').dataset.state).toBe(state);
      expect(buttons[0].disabled).toBe(['thinking', 'running', 'stopping', 'disposed'].includes(state));
      expect(buttons[1].disabled).toBe(!['thinking', 'running'].includes(state));
      expect(document.querySelector('[role=alert]').textContent).toBe(state === 'error' ? 'Verifier unavailable' : '');
    }
  });

  it('submits once, stops the active run, and does not discard an edited draft', async () => {
    let finish;
    const { agent, prompt, form, buttons, render } = setup({ run: vi.fn(() => new Promise(resolve => { finish = resolve; })) });
    prompt.value = 'first goal';
    const first = form.onsubmit({ preventDefault() {} });
    await form.onsubmit({ preventDefault() {} });
    expect(agent.run).toHaveBeenCalledTimes(1);
    render('thinking');
    buttons[1].click();
    await turn();
    expect(agent.stop).toHaveBeenCalledTimes(1);
    prompt.value = 'next goal';
    finish({ status: 'completed' });
    await first;
    expect(prompt.value).toBe('next goal');
  });

  it('keeps a stopped prompt and renders rejected provider or verifier errors', async () => {
    const { agent, prompt, form } = setup({ run: vi.fn(async () => ({ status: 'stopped' })) });
    prompt.value = 'retained goal';
    await form.onsubmit({ preventDefault() {} });
    expect(prompt.value).toBe('retained goal');
    agent.run.mockRejectedValueOnce(new Error('Verification is unavailable'));
    await form.onsubmit({ preventDefault() {} });
    expect(document.querySelector('[role=alert]').textContent).toBe('Verification is unavailable');
  });

  it('downloads only the source API result, and disposal removes action handlers', async () => {
    const { ui, exportSource, buttons, prompt, form, agent } = setup();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:source');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    buttons[2].click();
    await turn();
    expect(exportSource).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(click.mock.instances[0].download).toBe('zero-source.json');
    ui.dispose();
    prompt.value = 'ignored';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(agent.run).not.toHaveBeenCalled();
    expect(document.querySelector('.zero-capsule')).toBeNull();
  });

  it('parses restrained state-only animations and the reduced-motion override', () => {
    const css = readFileSync('self/zero/style.css', 'utf8');
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    const rules = [...style.sheet.cssRules];
    const animated = rules.filter(rule => rule.style?.getPropertyValue('animation'));
    expect(animated.map(rule => rule.selectorText)).toEqual([
      '.zero-state[data-state="thinking"]::before', '.zero-state[data-state="running"]::before']);
    const reduced = rules.find(rule => rule.conditionText === '(prefers-reduced-motion: reduce)');
    expect(reduced.cssRules[0].style.getPropertyValue('animation')).toBe('none');
    expect(reduced.cssRules[0].style.getPropertyPriority('animation')).toBe('important');
    expect(css).not.toMatch(/@keyframes[^}]+(?:width|height|margin|display):/);
  });
});
