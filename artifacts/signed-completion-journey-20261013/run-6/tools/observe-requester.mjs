// Read-only: the harness requester's newest attempt (status, response length) via its loopback inspector.
import { chromium } from 'playwright';
import { observeChat } from '../../observe.mjs';
const [endpoint, origin] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith(origin));
  const state = await observeChat(page);
  console.log(JSON.stringify(state.threads.map(t => ({ thread: t.id.slice(0, 8), attempts: t.attempts.map(a => ({ id: a.id.slice(0, 8), status: a.status, error: a.error,
    response: (t.messages.find(m => m.id === a.responseId)?.content || '').length, stepSummary: a.execution?.stepSummary ?? null })) }))));
} finally { await browser.close(); }
