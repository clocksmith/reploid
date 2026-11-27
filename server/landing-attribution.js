import { createHash } from 'node:crypto';
import express from 'express';

const PATH = '/api/landing-attribution';
const BODY = /^\{"v":"([A-Za-z0-9_-]{4})"\}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SITE_ORIGIN = 'https://replo.id';
const MAX_EVENTS_PER_MINUTE = 30;

/** Log only a hashed opaque campaign token, never the body or request metadata. With crossOrigin
 * (the API on its own hostname), the page's request arrives cross-site instead of same-origin. */
export function mountLandingAttribution(app, { now = Date.now, write = console.log, crossOrigin = false } = {}) {
  const fetchSite = crossOrigin ? 'cross-site' : 'same-origin';
  let minute = null, events = 0;
  const parser = express.text({ type: 'application/json', limit: 64, inflate: false });
  app.all(PATH, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.set('Allow', 'POST').status(405).end();
    if (req.originalUrl !== PATH) return res.status(400).end();
    if (req.get('Origin') !== SITE_ORIGIN ||
        (req.get('Sec-Fetch-Site') && req.get('Sec-Fetch-Site') !== fetchSite)) return res.status(403).end();
    if (req.get('Sec-GPC') === '1' || req.get('DNT') === '1') return res.status(204).end();
    if (!req.is('application/json')) return res.status(415).end();
    // The budget caps structured logs per process, not per visitor or machine.
    const window = Math.floor(now() / 60_000);
    if (window !== minute) { minute = window; events = 0; }
    if (events >= MAX_EVENTS_PER_MINUTE) return res.status(429).end();
    return parser(req, res, error => {
      if (error) return res.status([413, 415].includes(error.status) ? error.status : 400).end();
      const token = typeof req.body === 'string' && req.body.length === 12 ? BODY.exec(req.body)?.[1] : null;
      if (!token || ALPHABET[(ALPHABET.indexOf(token[0]) + ALPHABET.indexOf(token[1]) + ALPHABET.indexOf(token[2])) % 64] !== token[3]) return res.status(400).end();
      // Multiple parser callbacks may complete in the same window.
      if (events >= MAX_EVENTS_PER_MINUTE) return res.status(429).end();
      events++;
      const ref = createHash('sha256').update(token).digest('hex');
      const event = token.startsWith('z') ? 'reploid_landing_attribution_test_v1' : 'reploid_landing_attribution_v1';
      write(JSON.stringify({ event, ref }));
      return res.status(204).end();
    });
  });
}
