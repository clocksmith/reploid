#!/usr/bin/env node
/**
 * Pilot reliability measurement through the page a first user sees. The same fixed rule as
 * scripts/pilot/reliability.js (RULE there): 100 requests or more, one at a time; a request is completed only when
 * the page's execution line for the answer reads Complete and the answer has text; everything else is a failure and is never retried; a request
 * with no first character counts as slower than any limit; pass is 99% completed and a nearest-rank p95 first
 * character within 5 s.
 *
 * What is timed. The page stays open for the whole run, as a person's tab would. For each request the script starts
 * a new thread, types the prompt, waits for Send to be enabled, and clicks it. First-character time runs from that
 * click to the first visible character of the answer, both read from the page's own clock by an observer inside
 * the page, so the script's polling adds no error. It includes the page's route checks, admission, any queue, the
 * provider's prefill and the network. It does not include discovery before Send was enabled; that wait is recorded
 * separately as `sendEnabledMs`.
 *
 * Before the measured requests, one unmeasured setup request takes the "Where should this run?" sheet and the
 * remote-contributor permission, which a person meets once. If the sheet or the permission prompt appears again
 * during a measured request, the script answers it and the time it took stays in that request's measurement.
 *
 *   node scripts/pilot/browser-reliability.js --url http://127.0.0.1:8000/ [--model SELECTION_ID] \
 *     [--requests 100] [--interval-ms 25000] [--timeout-ms 120000] [--prompts FILE.json [--only-model MODEL_ID]] \
 *     [--channel chrome] [--headed] [--label TEXT] [--out FILE.json]
 *   node scripts/pilot/browser-reliability.js --self-check
 *
 * `--prompts` takes a file of `{ prompts: [{ id, prompt, model }] }`; without it the list in reliability.js is used.
 * One model per run: `--model` is the value of the model's choice in the sheet, chosen during the setup request.
 * If the setup request does not complete, the run stops there and reports why; it does not send the measured ones.
 * `--self-check` runs the whole script against a mock page that plays each ending. It checks this script's timing
 * and labels, and nothing about the product.
 *
 * The receipt holds no answer text and no address. It measures one browser on one network path, the public
 * contributor route of the page it was pointed at. It does not measure a paired computer, a split route, or the
 * step timeline that only the paired path records.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PROMPTS, RULE, summarize } from './reliability.js';

/**
 * How an answer ended, in the page's own words. Each answer row has an execution line whose first word is the
 * attempt's status (apps/poolday/ui/pool-home/execution-ribbon.js: Complete, Failed, Stopped, Interrupted,
 * Disconnected) and, for a failure only, a system line that says why (message-list.js, "System · ...").
 */
export function labelOf({ activity = '', statusText = '', outputChars, timedOut, sheetProblem }) {
  if (sheetProblem) return 'unavailable';
  if (timedOut) return 'timeout';
  const text = statusText.replace(/^System · /, '');
  // A completed answer may still carry a system note (a search that used some of its sources); the status decides.
  if (/^Complete\b/.test(activity)) return outputChars > 0 ? null : 'wrong';
  if (/^Not sent\b|not enough service credits|still unfinished|spending limit|Community Access|declined sharing/i.test(text)) return 'refused';
  if (/\bInterrupted\b|went away|was interrupted/i.test(text) || /^(Interrupted|Disconnected)\b/.test(activity)) return 'transport';
  if (/no (public |ready )?computer|nobody is serving|not available right now|unavailable/i.test(text)) return 'unavailable';
  if (/exceeded the available resources/i.test(text)) return 'resources';
  return 'other';
}

/** Installed in the page before any of its scripts: times the first visible character of the newest answer. */
function installProbe() {
  const rows = () => [...globalThis.document.querySelectorAll('[data-message-stream] .chat-message-row.is-assistant')];
  const shown = node => Boolean(node) && !node.hidden && node.getClientRects().length > 0;
  const probe = { before: 0, sentAt: null, firstAt: null, observer: null };
  const answer = () => rows()[probe.before] ?? null;
  const check = () => {
    if (probe.firstAt !== null || probe.sentAt === null) return;
    const text = answer()?.querySelector('.chat-message-content')?.textContent ?? '';
    if (text.trim().length > 0) probe.firstAt = globalThis.performance.now();
  };
  globalThis.__pilot = {
    send() {
      probe.before = rows().length;
      probe.firstAt = null;
      probe.observer ??= new globalThis.MutationObserver(check);
      probe.observer.observe(globalThis.document.body, { childList: true, subtree: true, characterData: true });
      probe.sentAt = globalThis.performance.now();
      globalThis.document.querySelector('[data-composer-send]').click();
    },
    state() {
      check();
      const row = answer(), now = globalThis.performance.now();
      return {
        firstTokenMs: probe.firstAt === null ? null : Math.round(probe.firstAt - probe.sentAt),
        elapsedMs: Math.round(now - probe.sentAt),
        sendShown: shown(globalThis.document.querySelector('[data-composer-send]')),
        sheetOpen: Boolean(globalThis.document.querySelector('[data-model-picker]')?.open),
        permissionShown: shown(globalThis.document.querySelector('[data-remote-permission] [data-remote-permission-allow]')),
        outputChars: (row?.querySelector('.chat-message-content')?.textContent ?? '').trim().length,
        statusText: (row?.querySelector('[data-system-status]')?.textContent ?? '').trim().slice(0, 300),
        // The execution line: "<status> · ...". The page marks it data-active while the attempt runs.
        activity: (row?.querySelector('[data-execution-trigger]')?.getAttribute('aria-label') ?? '').replace(/\. Execution details$/, '').slice(0, 200),
        active: Boolean(row?.querySelector('[data-execution-activity]')?.hasAttribute('data-active'))
      };
    }
  };
}

const ENDED = /^(Complete|Failed|Stopped|Interrupted|Disconnected)\b/;

const pickerOpen = page => page.evaluate(() => Boolean(globalThis.document.querySelector('[data-model-picker]')?.open));
const rowCount = page => page.evaluate(() => globalThis.document.querySelectorAll('[data-message-stream] .chat-message-row').length);

/** The "Where should this run?" sheet is modal: left open, it blocks every later request. */
async function closeSheet(page) {
  if (!await pickerOpen(page)) return;
  await page.locator('[data-model-picker-close]').click({ timeout: 3000 }).catch(() => page.keyboard.press('Escape'));
  await page.waitForFunction(() => !globalThis.document.querySelector('[data-model-picker]')?.open, null, { timeout: 5000 }).catch(() => {});
}

/** An empty thread is already new. Otherwise the thread list opens from its toggle, and New thread closes it again. */
async function newThread(page) {
  if (await rowCount(page) === 0) return;
  const button = page.locator('[data-new-thread]');
  if (!await button.isVisible()) await page.locator('[data-toggle-thread-rail]').click({ timeout: 5000 });
  await button.click({ timeout: 5000 });
  await page.waitForFunction(() => globalThis.document.querySelectorAll('[data-message-stream] .chat-message-row').length === 0, null, { timeout: 5000 });
}

/**
 * One request in a new thread. Never throws for a product failure: every ending becomes a record. `model`, when
 * given, is chosen inside the sheet if the sheet opens.
 */
async function measureOne(page, { prompt, timeoutMs, model = null, sheetWaitMs = 30000 }) {
  const record = { completed: false, failure: null, firstTokenMs: null, stages: { sendEnabledMs: null, firstTokenMs: null, endMs: null },
    sheet: false, permissionPrompt: false, outputChars: 0, activity: '', statusText: '', sendAt: null };
  try {
    await closeSheet(page);
    await newThread(page);
    await page.locator('[data-composer-input]').fill(prompt);
    const typed = Date.now();
    await page.waitForFunction(() => { const send = globalThis.document.querySelector('[data-composer-send]'); return send && !send.disabled && !send.hidden; },
      null, { timeout: 60000 });
    record.stages.sendEnabledMs = Date.now() - typed;
  } catch (error) {
    // The page never offered Send: nothing was asked, and the request counts as one the page could not take.
    const status = await page.locator('[data-model-status]').innerText({ timeout: 2000 }).catch(() => '');
    record.failure = 'unavailable';
    record.statusText = `Send was not offered: ${status.trim() || String(error.message).split('\n')[0]}`.slice(0, 300);
    return record;
  }
  record.sendAt = new Date().toISOString();
  await page.evaluate(() => globalThis.__pilot.send());
  let state, started = false, sheetProblem = null, timedOut = false;
  for (;;) {
    state = await page.evaluate(() => globalThis.__pilot.state());
    if (state.sheetOpen && !record.sheet) {
      record.sheet = true;
      await page.locator('[data-execution-choice=network]').click({ timeout: 5000 }).catch(() => {});
      if (model) await page.locator(`[data-model-picker] .chat-model-choices input[value="${model}"]`).filter({ visible: true }).click({ timeout: 15000 }).catch(() => {});
      // Either the choice sends by itself and the sheet closes, or its button turns into Send.
      const ready = await page.waitForFunction(() => {
        const picker = globalThis.document.querySelector('[data-model-picker]'), button = globalThis.document.querySelector('[data-change-model]');
        return !picker?.open || (button && !button.disabled && button.textContent.trim() === 'Send');
      }, null, { timeout: sheetWaitMs }).then(() => true, () => false);
      if (!ready) {
        const offered = await page.evaluate(() => [...globalThis.document.querySelectorAll('[data-execution-choice]')]
          .map(node => (node.textContent || '').trim().replace(/\s+/g, ' ')).join(' | ')).catch(() => '');
        const next = (await page.locator('[data-next-model-status]').innerText({ timeout: 2000 }).catch(() => '')).trim();
        sheetProblem = [next, offered].filter(Boolean).join(' / ').slice(0, 300) || 'no computer offered this model';
        await closeSheet(page);
        break;
      }
      if (await pickerOpen(page)) await page.locator('[data-change-model]').click({ timeout: 5000 }).catch(() => {});
      continue;
    }
    if (state.permissionShown) { record.permissionPrompt = true; await page.locator('[data-remote-permission] [data-remote-permission-allow]').click({ timeout: 5000 }).catch(() => {}); continue; }
    if (!state.sendShown || state.active || state.outputChars > 0 || state.statusText || state.activity) started = true;
    // Ended: Send is back, the execution line is no longer active, and it names a final status or a system line says why.
    if (started && state.sendShown && !state.active && (ENDED.test(state.activity) || state.statusText)) break;
    if (state.elapsedMs > timeoutMs) {
      timedOut = true;
      await closeSheet(page);
      await page.locator('[data-answer-stop]:visible, [data-composer-stop]:visible').first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => globalThis.__pilot.state().sendShown, null, { timeout: 15000 }).catch(() => {});
      state = await page.evaluate(() => globalThis.__pilot.state());
      break;
    }
    await page.waitForTimeout(100);
  }
  record.firstTokenMs = record.stages.firstTokenMs = state.firstTokenMs;
  record.stages.endMs = state.elapsedMs;
  record.outputChars = state.outputChars;
  record.activity = state.activity;
  record.statusText = sheetProblem ?? state.statusText;
  record.failure = labelOf({ activity: state.activity, statusText: state.statusText, outputChars: state.outputChars, timedOut, sheetProblem });
  record.completed = record.failure === null;
  return record;
}

/**
 * Opens the page once and sends the setup request and then every measured request, one at a time. If the setup
 * request does not complete, nothing is measured: `notStarted` says why, and that is a failed availability check,
 * not a measurement of 0 of N.
 */
export async function runBrowserPilot({ url, prompts, model = null, intervalMs = 25000, timeoutMs = 120000, sheetWaitMs = 30000, channel = null, headed = false,
  onResult = () => {} }) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: !headed, ...(channel ? { channel } : {}) });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.addInitScript(installProbe);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('[data-composer-send]').waitFor({ state: 'visible', timeout: 60000 });
    const setup = await measureOne(page, { prompt: 'Say hello in one word.', timeoutMs, model, sheetWaitMs });
    const answerOn = (await page.locator('[data-open-model]').getAttribute('aria-label').catch(() => null)) ?? null;
    if (!setup.completed) return { setup, answerOn, results: [], notStarted: `the setup request did not complete (${setup.failure}): ${setup.statusText || setup.activity || 'no status shown'}` };
    const results = [];
    for (const [index, item] of prompts.entries()) {
      const startedAt = Date.now();
      const row = { type: 'request', index, promptId: item.id, inputChars: item.prompt.length, ...await measureOne(page, { prompt: item.prompt, timeoutMs, model, sheetWaitMs }) };
      results.push(row);
      onResult(row);
      const wait = intervalMs - (Date.now() - startedAt);
      if (index < prompts.length - 1 && wait > 0) await page.waitForTimeout(wait);
    }
    return { setup, answerOn, results, notStarted: null };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Self-check: a mock page with the selectors above. The prompt's first word picks the ending it plays.
// ---------------------------------------------------------------------------------------------------------------

const MOCK_PAGE = `<!doctype html><meta charset="utf-8"><title>mock</title>
<button data-new-thread>New thread</button>
<div data-message-stream></div>
<dialog data-model-picker><button data-model-picker-close>Close</button><button data-execution-choice="local">This device</button><button data-execution-choice="network">Contributors</button><span data-next-model-status></span><button data-change-model disabled>Choose</button></dialog>
<div data-remote-permission hidden><button data-remote-permission-allow>Allow</button></div>
<textarea data-composer-input></textarea><button data-composer-send>Send</button><button data-composer-stop hidden>Stop</button>
<script>
const $ = selector => document.querySelector(selector), stream = $('[data-message-stream]'), send = $('[data-composer-send]'), stop = $('[data-composer-stop]');
let chosen = false, allowed = false, timers = [], current = null;
const later = (ms, run) => timers.push(setTimeout(run, ms));
// As the real page: the execution line carries the status and is data-active while running; the system line appears only for a failure.
const line = (row, summary, active) => { row.querySelector('[data-execution-trigger]').setAttribute('aria-label', summary + '. Execution details'); row.querySelector('[data-execution-activity]').toggleAttribute('data-active', active); };
const finish = (row, status, why = '') => { line(row, status + ' · 1 computer · Contributors', false); const system = row.querySelector('[data-system-status]'); system.hidden = !why; system.textContent = why ? 'System · ' + why : ''; send.hidden = false; stop.hidden = true; };
function start() {
  const word = $('[data-composer-input]').value.split(' ')[0];
  const kind = ['ok', 'slow', 'drop', 'refuse', 'empty', 'fail', 'hang'].includes(word) ? word : 'ok';
  if (!chosen) { $('[data-model-picker]').showModal(); return; }
  if (!allowed) { $('[data-remote-permission]').hidden = false; return; }
  const user = document.createElement('div'); user.className = 'chat-message-row is-user'; stream.append(user);
  const row = document.createElement('div'); row.className = 'chat-message-row is-assistant';
  row.innerHTML = '<div class="chat-message-content"></div><div class="chat-message-system" data-system-status hidden></div><div data-execution-activity><button data-execution-trigger aria-label=""></button></div>';
  stream.append(row); current = row;
  const body = row.querySelector('.chat-message-content');
  if (kind === 'refuse') { finish(row, 'Failed', 'Not sent. Not enough service credits: this answer can cost up to 192 and your account can spend 0 now.'); return; }
  send.hidden = true; stop.hidden = false; line(row, 'Queued', true);
  later(20, () => line(row, 'Generating · 1 computer', true));
  if (kind === 'ok') { later(80, () => { body.textContent = 'Hi'; }); later(160, () => finish(row, 'Complete')); }
  if (kind === 'slow') { later(40, () => { body.textContent = '  '; }); later(400, () => { body.textContent = 'Late'; }); later(450, () => finish(row, 'Complete')); }
  if (kind === 'drop') { later(60, () => { body.textContent = 'Half'; }); later(120, () => finish(row, 'Interrupted', 'Interrupted. That computer went away before finishing, so any text above is unverified.')); }
  if (kind === 'empty') later(60, () => finish(row, 'Complete'));
  if (kind === 'fail') later(60, () => finish(row, 'Failed', 'This answer could not finish.'));
  if (kind === 'hang') later(60, () => { body.textContent = 'Start'; });
}
send.onclick = start;
stop.onclick = () => { timers.forEach(clearTimeout); finish(current, 'Stopped', 'Stopped. Your partial answer is saved.'); };
$('[data-new-thread]').onclick = () => { stream.replaceChildren(); };
const empty = new URLSearchParams(location.search).has('empty');
$('[data-model-picker-close]').onclick = () => $('[data-model-picker]').close();
$('[data-execution-choice=network]').onclick = () => { const button = $('[data-change-model]');
  if (empty) { $('[data-next-model-status]').textContent = 'No contributor serves this model now.'; return; }
  button.disabled = false; button.textContent = 'Send'; };
$('[data-change-model]').onclick = () => { chosen = true; $('[data-model-picker]').close(); start(); };
$('[data-remote-permission-allow]').onclick = () => { allowed = true; $('[data-remote-permission]').hidden = true; start(); };
</script>`;

async function selfCheck() {
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(MOCK_PAGE); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const kinds = ['ok', 'slow', 'drop', 'refuse', 'empty', 'fail', 'hang', 'ok'];
  try {
    const { setup, results } = await runBrowserPilot({ url: `http://127.0.0.1:${server.address().port}/`, intervalMs: 0, timeoutMs: 1500,
      prompts: kinds.map((kind, index) => ({ id: `m${index}`, prompt: `${kind} request` })) });
    const problems = [], expect = (what, ok) => { if (!ok) problems.push(what); };
    const by = index => results[index];
    expect('setup took the sheet and the permission prompt', setup.sheet && setup.permissionPrompt);
    expect('no measured request met the sheet again', results.every(row => !row.sheet && !row.permissionPrompt));
    expect('ok completes with a first character near 80 ms', by(0).completed && by(0).firstTokenMs >= 70 && by(0).firstTokenMs < 300);
    expect('slow ignores whitespace and times the first real character near 400 ms', by(1).completed && by(1).firstTokenMs >= 390 && by(1).firstTokenMs < 700);
    expect('a dropped answer is transport and keeps its first-character time', by(2).failure === 'transport' && by(2).firstTokenMs !== null);
    expect('a credit refusal is refused with no first character', by(3).failure === 'refused' && by(3).firstTokenMs === null);
    expect('a complete answer with no text is wrong', by(4).failure === 'wrong');
    expect('an unexplained failure is other', by(5).failure === 'other');
    expect('a hung answer is stopped and labelled timeout', by(6).failure === 'timeout' && by(6).stages.endMs >= 1500);
    expect('the page still answers after a timeout', by(7).completed);
    const summary = summarize(results);
    expect('summary counts 3 of 8 completed and gives no verdict under 100 requests', summary.completed === 3 && /^not evaluated/.test(summary.verdict));
    expect('labels map the page\'s wording', labelOf({ activity: 'Failed', statusText: 'System · Not sent. Community Access cannot take this answer now.', outputChars: 0 }) === 'refused'
      && labelOf({ activity: 'Complete · 1 computer · Contributors', statusText: '', outputChars: 4 }) === null
      && labelOf({ activity: 'Disconnected', statusText: '', outputChars: 2 }) === 'transport'
      && labelOf({ activity: 'Complete', statusText: 'System · Using 2 retrieved sources. Some pages were unavailable.', outputChars: 4 }) === null
      && labelOf({ activity: 'Failed', statusText: 'System · This answer could not finish.', outputChars: 0 }) === 'other'
      && labelOf({ outputChars: 0, sheetProblem: 'x' }) === 'unavailable');
    expect('a completed answer shows no system line, only the execution line', by(0).statusText === '' && /^Complete/.test(by(0).activity));
    const none = await runBrowserPilot({ url: `http://127.0.0.1:${server.address().port}/?empty`, intervalMs: 0, timeoutMs: 1500, sheetWaitMs: 800,
      prompts: [{ id: 'm0', prompt: 'ok request' }] });
    expect('a pool with no contributor stops at the setup request, says why, and leaves the sheet closed',
      none.results.length === 0 && none.setup.failure === 'unavailable' && /did not complete \(unavailable\): No contributor serves this model now/.test(none.notStarted));
    console.log(JSON.stringify({ selfCheck: problems.length === 0 ? 'pass' : 'fail', problems,
      results: results.map(row => ({ id: row.promptId, completed: row.completed, failure: row.failure, firstTokenMs: row.firstTokenMs, endMs: row.stages.endMs })) }, null, 2));
    process.exitCode = problems.length === 0 ? 0 : 1;
  } finally {
    server.close();
  }
}

async function main() {
  const { values } = parseArgs({ options: { url: { type: 'string' }, model: { type: 'string' }, requests: { type: 'string', default: String(RULE.minimumRequests) },
    'interval-ms': { type: 'string', default: '25000' }, 'timeout-ms': { type: 'string', default: '120000' }, prompts: { type: 'string' },
    'only-model': { type: 'string' }, channel: { type: 'string' }, headed: { type: 'boolean', default: false }, label: { type: 'string', default: '' },
    out: { type: 'string' }, 'self-check': { type: 'boolean', default: false } } });
  if (values['self-check']) return selfCheck();
  if (!values.url) throw Error('Give --url, or --self-check');
  const number = name => { const value = Number(values[name]); if (!Number.isSafeInteger(value) || value < 0) throw Error(`--${name} must be a whole number`); return value; };
  let prompts = PROMPTS.map((prompt, index) => ({ id: `p${String(index + 1).padStart(2, '0')}`, prompt })), promptSource = 'scripts/pilot/reliability.js PROMPTS';
  if (values.prompts) {
    const file = JSON.parse(await fs.readFile(values.prompts, 'utf8'));
    prompts = file.prompts.filter(item => !values['only-model'] || item.model === values['only-model']).map(item => ({ id: item.id, prompt: item.prompt }));
    promptSource = `file with ${file.prompts.length} prompts${values['only-model'] ? `, ${prompts.length} for the chosen model` : ''}`;
  }
  const requests = number('requests');
  const list = Array.from({ length: requests }, (_, index) => prompts[index % prompts.length]);
  const settings = { model: values.model ?? null, requests, intervalMs: number('interval-ms'), timeoutMs: number('timeout-ms'), promptSource };
  const startedAt = new Date().toISOString();
  const run = await runBrowserPilot({ url: values.url, prompts: list, model: settings.model, intervalMs: settings.intervalMs, timeoutMs: settings.timeoutMs,
    channel: values.channel ?? null, headed: values.headed,
    onResult: row => console.error(`${String(row.index + 1).padStart(3)} ${row.completed ? 'ok  ' : 'FAIL'} first character ${row.firstTokenMs ?? '-'} ms, end ${row.stages.endMs} ms${row.failure ? `, ${row.failure}: ${row.statusText.slice(0, 80)}` : ''}`) });
  const host = new URL(values.url).hostname;
  const receipt = { schema: 'reploid.pilot-reliability-browser/v1', startedAt, finishedAt: new Date().toISOString(), label: values.label, rule: RULE,
    page: ['127.0.0.1', 'localhost', '[::1]'].includes(host) ? 'local page' : 'deployed page (address not recorded)', answerOn: run.answerOn, settings,
    node: process.version, setup: run.setup, notStarted: run.notStarted,
    summary: run.notStarted ? { requests: 0, verdict: `not started: ${run.notStarted}` } : summarize(run.results), results: run.results };
  const text = JSON.stringify(receipt, null, 2);
  if (values.out) await fs.writeFile(values.out, `${text}\n`);
  console.log(JSON.stringify({ label: receipt.label, answerOn: receipt.answerOn, ...receipt.summary }, null, 2));
  process.exitCode = receipt.summary.verdict === 'pass' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
