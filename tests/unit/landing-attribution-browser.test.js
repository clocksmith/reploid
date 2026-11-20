// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const html = readFileSync(new URL('../../apps/poolday/index.html', import.meta.url), 'utf8');
const boot = html.match(/<script id="reploid-landing-attribution">([\s\S]*?)<\/script>/)?.[1];
const code = 'K7pu';
function open(url, { navigator = {}, replaceState } = {}) {
  const history = { state: { preserved: true }, replaceState: replaceState || vi.fn() };
  const fetch = vi.fn(() => Promise.reject(new Error('optional network unavailable')));
  vm.runInNewContext(boot, { URLSearchParams, location: new URL(url), history, navigator, fetch });
  return { history, fetch };
}

describe('tagged homepage', () => {
  it('strips one short code before any optional request, keeping other URL bytes and history state', () => {
    const { history, fetch } = open(`https://replo.id/?room=room%20A&%76=${code}&x=%2f#ask`);
    expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(history.state, '', '/?room=room%20A&x=%2f#ask');
    expect(fetch.mock.invocationCallOrder[0]).toBeGreaterThan(history.replaceState.mock.invocationCallOrder[0]);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/landing-attribution', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: code }), credentials: 'omit',
      referrerPolicy: 'no-referrer', mode: 'same-origin', keepalive: true
    });
    expect(html.indexOf('id="reploid-landing-attribution"')).toBeLessThan(html.indexOf('<link '));
  });

  it.each(['', '?room=room-1', '?x=abc'])('leaves an ordinary visit untouched: %s', query => {
    const { history, fetch } = open(`https://replo.id/${query}`);
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['', 'short', 'K7pv', code + '%0A', code + '&v=' + code, code + '&%76=short', '<script>'])('cleans and declines malformed or ambiguous tags: %s', tag => {
    const { history, fetch } = open(`https://replo.id/?keep=1&v=${tag}&x=2#route`);
    expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(history.state, '', '/?keep=1&x=2#route');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('honors opt-outs and does not send when the URL cannot be scrubbed', () => {
    for (const navigator of [{ globalPrivacyControl: true }, { doNotTrack: '1' }]) {
      const { history, fetch } = open(`https://replo.id/?v=${code}`, { navigator });
      expect(history.replaceState).toHaveBeenCalledOnce();
      expect(fetch).not.toHaveBeenCalled();
    }
    expect(open(`https://replo.id/?v=${code}`, { replaceState() { throw Error('blocked'); } }).fetch).not.toHaveBeenCalled();
  });

  it('does not affect other product paths or hosts', () => {
    for (const url of [`https://replo.id/ask?v=${code}`, `http://localhost:8080/?v=${code}`]) {
      const { history, fetch } = open(url);
      expect(history.replaceState).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  });
});
