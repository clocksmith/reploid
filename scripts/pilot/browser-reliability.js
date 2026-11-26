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
 * Before the measured requests, the script waits for the page to finish "Finding computers…" (recorded as the setup's
 * `discoveryMs`), then sends one unmeasured setup request that chooses the run's model and takes the
 * remote-contributor permission, where the page asks for one. A first visitor's Send asks nothing
 * (docs/first-visit-journeys.md); if a sheet or a permission prompt does appear during a measured request, the
 * script answers it and the time it took stays in that request's measurement.
 *
 *   node scripts/pilot/browser-reliability.js --url http://127.0.0.1:8000/ [--model SELECTION_ID] \
 *     [--requests 100] [--interval-ms 25000] [--timeout-ms 120000] [--prompts FILE.json [--only-model MODEL_ID]] \
 *     [--channel chrome] [--headed] [--label TEXT] [--out FILE.json]
 *   node scripts/pilot/browser-reliability.js --url URL --sessions 4 --requests 20 [--gap-ms 3000] [--max-minutes M] [same options]
 *   node scripts/pilot/browser-reliability.js --self-check
 *   node scripts/pilot/browser-reliability.js --url http://127.0.0.1:8000/ --stub-answer-chars 2400 --interval-ms 0 --requests 50
 *
 * Every request also records the page's main-thread time (`mainThread`, from Chrome's task counters): before Send
 * (a new thread, the prompt typed) and from Send to the answer's end. The receipt's `mainThread` summary gives the
 * first and last five requests and the slope per request; a page whose cost per request grows with its history shows
 * there. `--stub-answer-chars N` reproduces that locally with no provider: the page's own session and history
 * database, answered by a scripted executor in the page that streams N characters (installStub); `--stub-refresh-ms
 * 100` adds the network refreshes a peer's answer causes.
 *
 * `--prompts` takes a file of `{ prompts: [{ id, prompt, model }] }`; without it the list in reliability.js is used.
 * One model per run: `--model` is the value of the model's choice in the sheet, chosen during the setup request.
 * Every request records the model its thread used (`model`, the page's own selection) and the "Answer on" label.
 * Before each measured Send the script checks the new thread's model and, if it differs, chooses it in the sheet;
 * that happens before the click, so it is not timed. If a request would still go, or went, to any other model, the
 * run stops there with a `wrong model` verdict: it never measures a different model under this one's name. Without
 * `--model`, every request must use the model the setup request used.
 * If the setup request does not complete, the run stops there and reports why; it does not send the measured ones.
 * `--sessions N` is the burst: N tabs, each its own browser context set up as above, press Send at the same moment,
 * `--requests` rounds of them (N × requests requests). A round ends when every tab's answer has ended; the next one
 * starts `--gap-ms` later. Each request is timed in its own page as above, so a wait behind the other tabs is in it.
 * Prompts are walked in order across each round (burstPrompt). `--max-minutes` stops before a round that would
 * start later than that; the receipt counts those rounds as not run. The verdict (summarizeBurst) counts every
 * failure as infinite and asks the pilot's bar of every level, whatever its size.
 * `--self-check` runs the whole script against a mock page that plays each ending. It checks this script's timing
 * and labels, and nothing about the product.
 *
 * The receipt holds no answer text and no address. It measures one browser on one network path, the public
 * contributor route of the page it was pointed at. It does not measure a paired computer, a split route, or the
 * step timeline that only the paired path records.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PROMPTS, RULE, percentile, summarize } from './reliability.js';

/**
 * How an answer ended, in the page's own words. Each answer row has an execution line whose first word is the
 * attempt's status (apps/poolday/host/decisions/transcript.js projectActivity: Complete, Failed, Stopped, Interrupted,
 * Disconnected) and, for a failure only, a system line that says why (apps/poolday-react/src/features/chat/presentation/MessagesView.tsx, "System · ...").
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
  const rows = () => [...globalThis.document.querySelectorAll('[data-message-stream] [data-message-role=assistant]')];
  const shown = node => Boolean(node) && !node.hidden && node.getClientRects().length > 0;
  const probe = { before: 0, sentAt: null, firstAt: null, observer: null };
  const answer = () => rows()[probe.before] ?? null;
  const check = () => {
    if (probe.firstAt !== null || probe.sentAt === null) return;
    const text = answer()?.querySelector('.pool-prose')?.textContent ?? '';
    if (text.trim().length > 0) probe.firstAt = globalThis.performance.now();
  };
  globalThis.__pilot = {
    sentAt: () => probe.sentAt,
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
        outputChars: (row?.querySelector('.pool-prose')?.textContent ?? '').trim().length,
        statusText: (row?.querySelector('[data-system-status]')?.textContent ?? '').trim().slice(0, 300),
        // The execution line: "<status> · ...". The page marks it data-active while the attempt runs.
        activity: (row?.querySelector('[data-execution-trigger]')?.getAttribute('aria-label') ?? '').replace(/\. Execution details$/, '').slice(0, 200),
        active: Boolean(row?.querySelector('[data-execution-activity]')?.hasAttribute('data-active'))
      };
    }
  };
}

const ENDED = /^(Complete|Failed|Stopped|Interrupted|Disconnected)\b/;

/**
 * The composer names the thread's model by its title ("Qwen 3.5 0.8B"), not its id. Each open sheet lists every
 * model's id beside its title, so the page's titles are learnt from the sheet and the composer's title is read back
 * as an id. A title never seen in a sheet is returned as it is, so it can never match an id by accident.
 */
const MODEL_TITLES = new WeakMap();
async function learnModels(page) {
  const pairs = await page.evaluate(() => [...globalThis.document.querySelectorAll('[data-model-picker] [data-model-choice]')].map(node => {
    const input = node.querySelector('input');
    return [(globalThis.document.getElementById(input?.getAttribute('aria-labelledby') ?? '')?.textContent ?? '').trim(), node.getAttribute('data-model-choice')];
  })).catch(() => []);
  const titles = MODEL_TITLES.get(page) ?? new Map();
  // An adapter row ("model/adapter") can share its base model's title; the base model keeps the title.
  for (const [title, id] of pairs) if (title && id && !id.includes('/') && !titles.has(title)) titles.set(title, id);
  MODEL_TITLES.set(page, titles);
}
async function selectedModel(page) {
  const title = await page.evaluate(() => globalThis.document.querySelector('[data-composer-model-name]')?.textContent?.trim() || null);
  return title === null ? null : MODEL_TITLES.get(page)?.get(title) ?? title;
}
const answerOnLabel = page => page.locator('[data-open-model]').getAttribute('aria-label', { timeout: 2000 }).catch(() => null);
const pickerOpen = page => page.evaluate(() => Boolean(globalThis.document.querySelector('[data-model-picker]')?.open));
const rowCount = page => page.evaluate(() => globalThis.document.querySelectorAll('[data-message-stream] [data-message-role]').length);

/** The "Answer on" sheet is modal: left open, it blocks every later request. */
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
  await page.waitForFunction(() => globalThis.document.querySelectorAll('[data-message-stream] [data-message-role]').length === 0, null, { timeout: 5000 });
}

/**
 * Chooses `model` on Contributors through "Answer on", as a person would. A usable choice applies on tap. The tap goes
 * to the row's radio input: it covers the row, so a click aimed at the label is intercepted and never lands.
 */
async function chooseModel(page, model) {
  await closeSheet(page);
  await page.locator('[data-open-model]').click({ timeout: 5000 });
  await page.locator('[data-execution-choice=network]').click({ timeout: 5000 }).catch(() => {});
  await page.locator(`[data-model-picker] [data-model-choice="${model}"]`).waitFor({ timeout: 15000 }).catch(() => {});
  await learnModels(page);
  await page.locator(`[data-model-picker] [data-model-choice="${model}"] input`).click({ timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => !globalThis.document.querySelector('[data-model-picker]')?.open, null, { timeout: 5000 }).catch(() => {});
  await closeSheet(page);
}

/**
 * One request in a new thread. Never throws for a product failure: every ending becomes a record. `model`, when
 * given, is chosen inside the sheet if the sheet opens.
 */
async function measureOne(page, options) {
  const before = await mainThread(page);
  const prepared = await prepareOne(page, options);
  const typed = await mainThread(page);
  const record = prepared.failure ? prepared : await sendAndWatch(page, prepared, options);
  const after = await mainThread(page);
  record.mainThread = before && typed && after ? { prepareTaskMs: Math.round((typed.task - before.task) * 1000), answerTaskMs: Math.round((after.task - typed.task) * 1000),
    taskMs: Math.round((after.task - before.task) * 1000), scriptMs: Math.round((after.script - before.script) * 1000), heapMb: Number((after.heap / 1048576).toFixed(1)) } : null;
  // Only the local stub knows when the request reached execution: Send click to the executor's first call, on the page's clock.
  const dispatchMs = await page.evaluate(() => globalThis.__pilotStub?.dispatchMs ?? null).catch(() => null);
  if (dispatchMs !== null) record.stages.dispatchMs = dispatchMs;
  return record;
}

/**
 * The page's main-thread time so far, from Chrome's own counters (CDP Performance.getMetrics): TaskDuration is every
 * task the main thread ran, ScriptDuration the JavaScript in them. A request's cost is the difference across it, so
 * waiting for the network or the provider adds nothing to it. Null where the browser offers no such session.
 */
const CDP_SESSIONS = new WeakMap();
async function mainThread(page) {
  try {
    if (!CDP_SESSIONS.has(page)) {
      const session = await page.context().newCDPSession(page);
      await session.send('Performance.enable');
      CDP_SESSIONS.set(page, session);
    }
    const { metrics } = await CDP_SESSIONS.get(page).send('Performance.getMetrics');
    const value = name => metrics.find(item => item.name === name)?.value ?? 0;
    return { task: value('TaskDuration'), script: value('ScriptDuration'), heap: value('JSHeapUsedSize') };
  } catch { return null; }
}

/**
 * Per-request main-thread time over a run: the mean of the first and of the last five requests, and the
 * least-squares slope per request. A page whose work per request does not depend on its history has a slope near 0.
 */
export function summarizeMainThread(rows) {
  const values = rows.map(row => row.mainThread?.taskMs).filter(Number.isFinite);
  if (values.length < 2) return null;
  const mean = list => Math.round(list.reduce((sum, value) => sum + value, 0) / list.length);
  const n = values.length, xMean = (n - 1) / 2, yMean = values.reduce((sum, value) => sum + value, 0) / n;
  const slope = values.reduce((sum, value, index) => sum + (index - xMean) * (value - yMean), 0) / values.reduce((sum, _, index) => sum + (index - xMean) ** 2, 0);
  return { requests: n, firstFiveMeanMs: mean(values.slice(0, 5)), lastFiveMeanMs: mean(values.slice(-5)), slopeMsPerRequest: Number(slope.toFixed(2)) };
}

/**
 * Local reproduction only (--stub-answer-chars): replaces the page's host with the same conversation session over
 * the same requester-owned history database the page uses, and answers from a scripted executor in the page, so no
 * provider and no GPU is involved. Everything between Send and execution, and every save and render while the
 * answer streams, is the product's own code. The executor emits `deltaChars` characters every `deltaMs`. With
 * `refreshMs` it also asks the session to refresh its network view that often while an answer streams, as the
 * page's swarm does for a peer's steps (product-session.js coalesces those to one per 100 ms).
 */
async function installStub(page, { answerChars, deltaChars = 4, deltaMs = 10, refreshMs = 0 }) {
  await page.locator('[data-composer-send]').waitFor({ state: 'visible', timeout: 60000 });
  await page.evaluate(async ({ answerChars, deltaChars, deltaMs, refreshMs }) => {
    const { document, navigator, performance, localStorage } = globalThis;
    // The page's own host closes on pagehide and releases the history owner lock this session then takes.
    globalThis.dispatchEvent(new globalThis.PageTransitionEvent('pagehide', { persisted: false }));
    const [{ openCanonicalChatSession, LOCAL_HISTORY_IDENTITY, CANONICAL_CHAT_MODELS }, { acquireChatHistoryOwner }, { metadataDigest }, { mountPoolday }, policy] = await Promise.all([
      import('/host/chat-session.js'), import('/host/chat-history.js'), import('/config/doppler-metadata-contract.js'), import('/ui/react/app.js'),
      globalThis.fetch('/config/ordered-participation.json').then(response => response.json())]);
    const { database, ...bounds } = policy.requesterHistory;
    let release = null;
    for (let attempt = 0; attempt < 10 && !release; attempt++) release = await acquireChatHistoryOwner({ name: database, locks: navigator.locks });
    if (!release) throw Error('The page did not release its conversation history');
    const model = CANONICAL_CHAT_MODELS.find(item => !item.partition && !item.adapters?.length);
    const stub = globalThis.__pilotStub = { dispatchMs: null };
    const words = 'The scripted answer repeats this sentence until it is as long as the run asked for. ';
    const scheduler = {
      prepare: async () => {}, unload: async () => {}, close: async () => {}, getState: () => ({}),
      async schedule(request, { signal, onDelta }) {
        stub.dispatchMs = Math.round(performance.now() - globalThis.__pilot.sentAt());
        let content = '', refreshed = performance.now();
        while (content.length < answerChars) {
          await new Promise(resolve => { globalThis.setTimeout(resolve, deltaMs); });
          signal?.throwIfAborted();
          const text = Array.from({ length: deltaChars }, (_, index) => words[(content.length + index) % words.length]).join('');
          content += text; onDelta(text);
          if (refreshMs > 0 && performance.now() - refreshed >= refreshMs) { refreshed = performance.now(); session.refreshNetwork(); }
        }
        return { model: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [], content };
      }
    };
    const session = await openCanonicalChatSession({ zeroRequesterWeights: false, storage: localStorage, scheduler,
      swarm: { getState: () => ({ sharing: false, consumer: { peers: [] } }) }, ...LOCAL_HISTORY_IDENTITY,
      history: { mode: 'transactional', publication: 'ordered', reason: null },
      canonical: { name: database, ...bounds, runtime: { metadataDigest }, publication: 'ordered', expectedWriterEpoch: 'stored', release } });
    session.setCachedModels([{ id: model.id, identity: model.identity }]);
    const root = document.createElement('div'); document.body.replaceChildren(root);
    mountPoolday(root, { host: { chat: session, close: () => session.close() }, viewState: { chosenModel: model, executionLocation: 'local' } });
  }, { answerChars, deltaChars, deltaMs, refreshMs });
  await page.locator('[data-composer-send]').waitFor({ state: 'visible', timeout: 60000 });
}

/** Everything before Send: a new thread on the right model, the prompt typed, Send enabled. Not timed. */
async function prepareOne(page, { prompt, expectModel = null }) {
  const record = { completed: false, failure: null, firstTokenMs: null, stages: { sendEnabledMs: null, firstTokenMs: null, endMs: null },
    sheet: false, permissionPrompt: false, outputChars: 0, activity: '', statusText: '', sendAt: null, model: null, answerOn: null, modelChosen: false };
  try {
    await closeSheet(page);
    await newThread(page);
    // The model this thread will ask, checked before Send so a different one is never measured under this name.
    if (expectModel && await selectedModel(page) !== expectModel) { record.modelChosen = true; await chooseModel(page, expectModel); }
    if (expectModel && await selectedModel(page) !== expectModel) {
      record.model = await selectedModel(page); record.answerOn = await answerOnLabel(page);
      record.failure = 'wrong model';
      record.statusText = `This thread would ask ${record.model ?? 'no model'}, not ${expectModel}; nothing was sent.`;
      return record;
    }
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
  return record;
}

/** Clicks Send and watches the answer to its end. Never throws for a product failure. */
async function sendAndWatch(page, record, { timeoutMs, model = null, expectModel = null, sheetWaitMs = 30000 }) {
  record.sendAt = new Date().toISOString();
  await page.evaluate(() => globalThis.__pilot.send());
  let state, started = false, sheetProblem = null, timedOut = false;
  for (;;) {
    state = await page.evaluate(() => globalThis.__pilot.state());
    if (state.sheetOpen && !record.sheet) {
      record.sheet = true;
      await page.locator('[data-execution-choice=network]').click({ timeout: 5000 }).catch(() => {});
      // A person waits until the model is listed among the public network's ready models; tapping Contributors
      // alone picks whatever model is ready first, so the sheet must never send before the model is chosen.
      const listed = !model || await page.waitForFunction(id => Boolean(globalThis.document.querySelector(`[data-model-picker] [data-choice-group=shared] [data-model-choice="${id}"]`)),
        model, { timeout: sheetWaitMs }).then(() => true, () => false);
      await learnModels(page);
      if (listed && model) await page.locator(`[data-model-picker] [data-model-choice="${model}"] input`).click({ timeout: 15000 }).catch(() => {});
      // The tap applies a moment later: the sheet closes and sends, or stays open with the row checked.
      const checked = id => { const picker = globalThis.document.querySelector('[data-model-picker]'); return !picker?.open || Boolean(picker.querySelector(`[data-model-choice="${id}"] input:checked`)); };
      if (listed && model) await page.waitForFunction(checked, model, { timeout: 5000 }).catch(() => {});
      const chosen = !model || await page.evaluate(checked, model) || await selectedModel(page) === model;
      if (!listed || !chosen) {
        const row = await page.evaluate(id => (globalThis.document.querySelector(`[data-model-picker] [data-model-choice="${id}"]`)?.textContent ?? 'not listed').trim().replace(/\s+/g, ' '), model).catch(() => '');
        sheetProblem = `${model} was not offered by a public computer (${row.slice(0, 120)}); nothing was sent`;
        await closeSheet(page);
        break;
      }
      // Either the choice sends by itself and the sheet closes, or its button turns into Send ("Send to contributors").
      const ready = await page.waitForFunction(() => {
        const picker = globalThis.document.querySelector('[data-model-picker]'), button = globalThis.document.querySelector('[data-change-model]');
        return !picker?.open || (button && !button.disabled && /^Send\b/.test(button.textContent.trim()));
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
  // The sent thread's own model, read after the answer: the composer keeps showing it while the thread is open.
  record.model = await selectedModel(page); record.answerOn = await answerOnLabel(page);
  if ((expectModel ?? model) && !sheetProblem && record.model !== (expectModel ?? model)) {
    record.failure = 'wrong model';
    record.statusText = `This request asked ${record.model ?? 'no model'}, not ${expectModel ?? model}.`;
  }
  record.completed = record.failure === null;
  return record;
}

/**
 * Opens the page once and sends the setup request and then every measured request, one at a time. If the setup
 * request does not complete, nothing is measured: `notStarted` says why, and that is a failed availability check,
 * not a measurement of 0 of N.
 */
/**
 * A person's tab: its own browser context (no shared storage or connections), the page opened, discovery waited
 * out and recorded as `discoveryMs`, then the unmeasured setup request that takes the sheet and the permission.
 */
async function openSession(browser, { url, model, timeoutMs, sheetWaitMs, stub = null }) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.addInitScript(installProbe);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (stub) await installStub(page, stub);
  await page.locator('[data-composer-send]').waitFor({ state: 'visible', timeout: 60000 });
  // Send is offered while the page is still "Finding computers…". A person would wait for that line to change;
  // pressed earlier, the sheet can read as if nobody serves the model. The wait is recorded, not hidden.
  const opened = Date.now();
  await page.waitForFunction(() => !/Finding computers/i.test(globalThis.document.querySelector('[data-model-status]')?.textContent ?? ''),
    null, { timeout: 60000 }).catch(() => {});
  const discoveryMs = Date.now() - opened;
  return { page, setup: { discoveryMs, ...await measureOne(page, { prompt: 'Say hello in one word.', timeoutMs, model, sheetWaitMs }) } };
}

export async function runBrowserPilot({ url, prompts, model = null, intervalMs = 25000, timeoutMs = 120000, sheetWaitMs = 30000, channel = null, headed = false,
  stub = null, onResult = () => {} }) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: !headed, ...(channel ? { channel } : {}) });
  try {
    const { page, setup } = await openSession(browser, { url, model, timeoutMs, sheetWaitMs, stub });
    const answerOn = setup.answerOn;
    if (!setup.completed) return { setup, answerOn, results: [], wrongModel: null, notStarted: `the setup request did not complete (${setup.failure}): ${setup.statusText || setup.activity || 'no status shown'}` };
    // Every measured request must ask the model the setup request asked: the one named by --model when given.
    const expectModel = model ?? setup.model;
    const results = [];
    for (const [index, item] of prompts.entries()) {
      const startedAt = Date.now();
      const row = { type: 'request', index, promptId: item.id, inputChars: item.prompt.length, ...await measureOne(page, { prompt: item.prompt, timeoutMs, model, expectModel, sheetWaitMs }) };
      results.push(row);
      onResult(row);
      if (row.failure === 'wrong model') return { setup, answerOn, results, notStarted: null, wrongModel: `request ${index + 1}: ${row.statusText}` };
      const wait = intervalMs - (Date.now() - startedAt);
      if (index < prompts.length - 1 && wait > 0) await page.waitForTimeout(wait);
    }
    return { setup, answerOn, results, notStarted: null, wrongModel: null };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Burst: several people pressing Send at the same moment, each in their own tab.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The prompt for `session` in `round` when `sessions` tabs send together: the list is walked in order across each
 * round and then on to the next, so no two tabs in a round share a prompt while the list is longer than the round.
 */
export function burstPrompt(prompts, sessions, session, round) {
  return prompts[(round * sessions + session) % prompts.length];
}

/**
 * One concurrency level over every request it sent. A failure counts as infinite even if a character appeared,
 * so p50 and p95 are nearest-rank over every request. The bar is the pilot's: 99% completed (every request when
 * there are fewer than 100) and a p95 within 5 s. JSON has no infinity: an infinite percentile is written 'inf'.
 */
export function summarizeBurst(rows) {
  const times = rows.map(row => (row.completed && row.firstTokenMs !== null ? row.firstTokenMs : Infinity));
  const shown = value => (value === null ? null : Number.isFinite(value) ? value : 'inf');
  const failures = {};
  for (const row of rows) if (!row.completed) failures[row.failure] = (failures[row.failure] ?? 0) + 1;
  const completed = rows.filter(row => row.completed).length;
  const p95 = percentile(times, RULE.firstTokenPercentile);
  const completedEnough = rows.length > 0 && completed >= Math.ceil(RULE.completedShare * rows.length);
  const fastEnough = p95 !== null && p95 <= RULE.firstTokenLimitMs;
  return { requests: rows.length, completed, completionRate: rows.length ? Number((completed / rows.length).toFixed(4)) : null, failures,
    firstCharacterMs: { p50: shown(percentile(times, 50)), p95: shown(p95) }, withinLimit: times.filter(value => value <= RULE.firstTokenLimitMs).length,
    checks: { completedEnough, fastEnough }, verdict: rows.length === 0 ? 'not run' : completedEnough && fastEnough ? 'pass' : 'fail' };
}

/**
 * `sessions` tabs, each opened and set up as in runBrowserPilot, then `rounds` rounds. In each round every tab
 * starts a new thread and types its prompt (not timed); once all are ready, all press Send together and the round
 * ends when every answer has ended. The next round starts `gapMs` later. Each request is timed in its own page
 * exactly as a sequential one is, so the time includes any queue behind the other tabs. `deadline` (epoch ms), when
 * given, ends the run before a round that would start after it; the rounds not started are counted, not invented.
 */
export async function runBurst({ url, prompts, sessions, rounds, model = null, gapMs = 3000, timeoutMs = 120000, sheetWaitMs = 30000, deadline = null,
  channel = null, headed = false, onResult = () => {}, onRound = () => {} }) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: !headed, ...(channel ? { channel } : {}) });
  const load = () => os.loadavg().map(value => Number(value.toFixed(2)));
  try {
    const opened = await Promise.all(Array.from({ length: sessions }, () => openSession(browser, { url, model, timeoutMs, sheetWaitMs })));
    const setups = opened.map(({ setup }, session) => ({ session, ...setup }));
    const broken = setups.find(setup => !setup.completed);
    if (broken) return { setups, results: [], rounds: [], roundsNotRun: rounds, wrongModel: null,
      notStarted: `session ${broken.session + 1}'s setup request did not complete (${broken.failure}): ${broken.statusText || broken.activity || 'no status shown'}` };
    const expectModel = model ?? setups[0].model;
    const results = [], roundLog = [];
    for (let round = 0; round < rounds; round++) {
      if (deadline !== null && Date.now() > deadline) return { setups, results, rounds: roundLog, roundsNotRun: rounds - round, wrongModel: null, notStarted: null };
      const items = opened.map((_, session) => burstPrompt(prompts, sessions, session, round));
      const ready = await Promise.all(opened.map(({ page }, session) => prepareOne(page, { prompt: items[session].prompt, expectModel })));
      const rows = await Promise.all(opened.map(({ page }, session) => (ready[session].failure ? ready[session]
        : sendAndWatch(page, ready[session], { timeoutMs, model, expectModel, sheetWaitMs }))
        .then(record => ({ type: 'request', round, session, promptId: items[session].id, inputChars: items[session].prompt.length, ...record }))));
      const sent = rows.map(row => row.sendAt).filter(Boolean).map(at => Date.parse(at));
      const entry = { round, sent: sent.length, sendSpreadMs: sent.length ? Math.max(...sent) - Math.min(...sent) : null,
        firstSendAt: sent.length ? new Date(Math.min(...sent)).toISOString() : null, endedAt: new Date().toISOString(), requesterLoad: load() };
      roundLog.push(entry);
      for (const row of rows) { results.push(row); onResult(row); }
      onRound(entry);
      const stop = rows.find(row => row.failure === 'wrong model');
      if (stop) return { setups, results, rounds: roundLog, roundsNotRun: rounds - round - 1, notStarted: null,
        wrongModel: `round ${round + 1}, session ${stop.session + 1}: ${stop.statusText}` };
      if (round < rounds - 1 && gapMs > 0) await new Promise(resolve => setTimeout(resolve, gapMs));
    }
    return { setups, results, rounds: roundLog, roundsNotRun: 0, wrongModel: null, notStarted: null };
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
<dialog data-model-picker><button data-model-picker-close>Close</button><button data-execution-choice="local">This device</button><button data-execution-choice="network">Contributors</button>
<div data-choice-group="shared"><div data-model-choice="small"><input id="m-small" type="radio" name="model" value="small" aria-labelledby="t-small"><label for="m-small"><span id="t-small">Small Model</span> Ready</label></div>
<div data-model-choice="small/adapter"><input id="m-adapter" type="radio" name="model" value="small/adapter" aria-labelledby="t-adapter"><label for="m-adapter"><span id="t-adapter">Big Model</span> No computer serves it now</label></div>
<div data-model-choice="big"><input id="m-big" type="radio" name="model" value="big" aria-labelledby="t-big"><label for="m-big"><span id="t-big">Big Model</span> Ready</label></div></div>
<span data-next-model-status></span><button data-change-model disabled>Choose</button></dialog>
<button data-open-model aria-label="Answer on Contributors · Small Model, Ready"><span data-composer-model-name>Small Model</span></button>
<div data-remote-permission hidden><button data-remote-permission-allow>Allow</button></div>
<p data-model-status>Finding computers…</p>
<textarea data-composer-input></textarea><button data-composer-send>Send</button><button data-composer-stop hidden>Stop</button>
<script>
const $ = selector => document.querySelector(selector), stream = $('[data-message-stream]'), send = $('[data-composer-send]'), stop = $('[data-composer-stop]');
let chosen = false, allowed = false, timers = [], current = null, bySend = false, answered = 0;
// ?forget: New thread returns to the default model, as the page did before. ?lose: after the setup answer, no other model can be chosen.
// As the React page: the composer names the model by its title only.
const query = new URLSearchParams(location.search), TITLES = { small: 'Small Model', big: 'Big Model' };
const setModel = value => { $('[data-composer-model-name]').textContent = TITLES[value]; $('[data-open-model]').setAttribute('aria-label', 'Answer on Contributors · ' + TITLES[value] + ', Ready'); };
const later = (ms, run) => timers.push(setTimeout(run, ms));
// ?nobig: the big model is listed, but not among the public network's ready models.
if (query.has('nobig')) { const group = document.createElement('div'); group.dataset.choiceGroup = 'unavailable'; group.append($('[data-model-choice=big]')); $('[data-model-picker]').append(group); }
// As the real page: the execution line carries the status and is data-active while running; the system line appears only for a failure.
const line = (row, summary, active) => { row.querySelector('[data-execution-trigger]').setAttribute('aria-label', summary + '. Execution details'); row.querySelector('[data-execution-activity]').toggleAttribute('data-active', active); };
const finish = (row, status, why = '') => { line(row, status + ' · 1 computer · Contributors', false); const system = row.querySelector('[data-system-status]'); system.hidden = !why; system.textContent = why ? 'System · ' + why : ''; send.hidden = false; stop.hidden = true; };
function start() {
  const word = $('[data-composer-input]').value.split(' ')[0];
  const kind = ['ok', 'slow', 'drop', 'refuse', 'empty', 'fail', 'hang'].includes(word) ? word : 'ok';
  if (!chosen) { bySend = true; $('[data-model-picker]').showModal(); return; }
  answered++;
  if (!allowed) { $('[data-remote-permission]').hidden = false; return; }
  const user = document.createElement('article'); user.dataset.messageRole = 'user'; user.innerHTML = '<div class="pool-message-text">question</div>'; stream.append(user);
  const row = document.createElement('article'); row.dataset.messageRole = 'assistant';
  row.innerHTML = '<div class="pool-prose"></div><span data-system-status hidden></span><div class="pool-message-footer"><div data-execution-activity><button data-execution-trigger aria-label="">details</button></div></div>';
  stream.append(row); current = row;
  const body = row.querySelector('.pool-prose');
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
setTimeout(() => { $('[data-model-status]').textContent = ''; }, 300);
send.onclick = start;
stop.onclick = () => { timers.forEach(clearTimeout); finish(current, 'Stopped', 'Stopped. Your partial answer is saved.'); };
$('[data-new-thread]').onclick = () => { stream.replaceChildren(); if (query.has('forget')) setModel('small'); };
$('[data-open-model]').onclick = () => { bySend = false; $('[data-model-picker]').showModal(); };
for (const radio of document.querySelectorAll('[data-model-choice] input')) radio.onclick = () => {
  if (radio.value.includes('/')) return;
  if (query.has('lose') && answered > 0) return;
  setModel(radio.value);
  if (!bySend && chosen) $('[data-model-picker]').close();
};
const empty = new URLSearchParams(location.search).has('empty');
$('[data-model-picker-close]').onclick = () => $('[data-model-picker]').close();
$('[data-execution-choice=network]').onclick = () => { const button = $('[data-change-model]');
  if (empty) { $('[data-next-model-status]').textContent = 'No contributor serves this model now.'; return; }
  button.disabled = false; button.textContent = 'Send to contributors'; };
$('[data-change-model]').onclick = () => { chosen = true; $('[data-model-picker]').close(); start(); };
$('[data-remote-permission-allow]').onclick = () => { allowed = true; $('[data-remote-permission]').hidden = true; start(); };
</script>`;

async function selfCheck() {
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(MOCK_PAGE); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const kinds = ['ok', 'slow', 'drop', 'refuse', 'empty', 'fail', 'hang', 'ok'];
  try {
    // ?forget: each New thread returns to the default model, so every measured request must choose the model again.
    const { setup, results } = await runBrowserPilot({ url: `http://127.0.0.1:${server.address().port}/?forget`, model: 'big', intervalMs: 0, timeoutMs: 1500,
      prompts: kinds.map((kind, index) => ({ id: `m${index}`, prompt: `${kind} request` })) });
    const problems = [], expect = (what, ok) => { if (!ok) problems.push(what); };
    const by = index => results[index];
    expect('setup took the sheet and the permission prompt', setup.sheet && setup.permissionPrompt);
    expect('setup waited for discovery to settle before pressing Send', setup.discoveryMs >= 250 && setup.discoveryMs < 5000);
    expect('no measured request met the sheet again', results.every(row => !row.sheet && !row.permissionPrompt));
    expect('setup and every measured request asked the chosen model, choosing it again after New thread reset it',
      setup.model === 'big' && results.length === kinds.length && results.every(row => row.model === 'big' && row.modelChosen && /· Big Model, Ready$/.test(row.answerOn)));
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
    const lost = await runBrowserPilot({ url: `http://127.0.0.1:${server.address().port}/?forget&lose`, model: 'big', intervalMs: 0, timeoutMs: 1500,
      prompts: [{ id: 'm0', prompt: 'ok request' }, { id: 'm1', prompt: 'ok request' }] });
    expect('a thread that cannot be put on the chosen model stops the run before Send, naming the model it would have asked',
      lost.setup.completed && lost.results.length === 1 && lost.results[0].failure === 'wrong model' && lost.results[0].sendAt === null
      && lost.results[0].model === 'small' && /^request 1: This thread would ask small, not big/.test(lost.wrongModel));
    const unready = await runBrowserPilot({ url: `http://127.0.0.1:${server.address().port}/?nobig`, model: 'big', intervalMs: 0, timeoutMs: 1500, sheetWaitMs: 800,
      prompts: [{ id: 'm0', prompt: 'ok request' }] });
    expect('a model no public computer offers is never sent to whatever model is ready instead',
      unready.results.length === 0 && unready.setup.failure === 'unavailable' && unready.setup.outputChars === 0 && unready.setup.firstTokenMs === null
      && /big was not offered by a public computer/.test(unready.notStarted));
    const unchecked = await runBrowserPilot({ url: `http://127.0.0.1:${server.address().port}/?forget`, intervalMs: 0, timeoutMs: 1500,
      prompts: [{ id: 'm0', prompt: 'ok request' }] });
    expect('without --model every request is held to the model the setup request asked', unchecked.setup.model === 'small'
      && unchecked.results.length === 1 && unchecked.results[0].completed && unchecked.results[0].model === 'small' && !unchecked.results[0].modelChosen);
    // Burst: three tabs, three rounds. Round 2's middle tab hangs; the round waits for its timeout before round 3.
    const burstItems = ['ok a', 'ok b', 'ok c', 'ok d', 'hang e', 'slow f', 'ok g', 'ok h', 'ok i'].map((prompt, index) => ({ id: `b${index}`, prompt }));
    const burst = await runBurst({ url: `http://127.0.0.1:${server.address().port}/?forget`, model: 'big', sessions: 3, rounds: 3, gapMs: 0, timeoutMs: 1500, prompts: burstItems });
    const burstRows = burst.results;
    expect('a burst sets up every tab in its own context and sends sessions × rounds requests',
      burst.setups.length === 3 && burst.setups.every(setup => setup.completed && setup.sheet && setup.permissionPrompt) && burstRows.length === 9 && burst.roundsNotRun === 0);
    expect('each round walks the prompts in order across its tabs', burstRows.map(row => row.promptId).join() === burstItems.map(item => item.id).join()
      && burstRows.every((row, index) => row.round === Math.floor(index / 3) && row.session === index % 3));
    expect('every tab in a round presses Send together', burst.rounds.length === 3 && burst.rounds.every(entry => entry.sent === 3 && entry.sendSpreadMs < 250));
    expect('a round waits for its slowest answer, and the next round sends after it ended',
      burstRows[4].failure === 'timeout' && Date.parse(burst.rounds[2].firstSendAt) >= Date.parse(burstRows[4].sendAt) + 1500);
    expect('every burst request asked the chosen model', burstRows.every(row => row.model === 'big'));
    const burstSummary = summarizeBurst(burstRows);
    expect('the burst summary counts the timeout as infinite and fails the level', burstSummary.completed === 8 && burstSummary.failures.timeout === 1
      && burstSummary.firstCharacterMs.p95 === 'inf' && burstSummary.verdict === 'fail');
    const late = await runBurst({ url: `http://127.0.0.1:${server.address().port}/?forget`, model: 'big', sessions: 2, rounds: 3, gapMs: 0, timeoutMs: 1500,
      prompts: burstItems, deadline: Date.now() - 1 });
    expect('a burst past its deadline starts no round and counts them as not run', late.results.length === 0 && late.roundsNotRun === 3 && late.setups.length === 2);
    console.log(JSON.stringify({ selfCheck: problems.length === 0 ? 'pass' : 'fail', problems,
      results: results.map(row => ({ id: row.promptId, completed: row.completed, failure: row.failure, firstTokenMs: row.firstTokenMs, endMs: row.stages.endMs })) }, null, 2));
    process.exitCode = problems.length === 0 ? 0 : 1;
  } finally {
    server.close();
  }
}

/** --sessions N: N tabs press Send together, --requests rounds of them (so N × requests requests). */
async function mainBurst(values, number, prompts, promptSource) {
  const sessions = number('sessions'), rounds = number('requests');
  if (sessions < 1) throw Error('--sessions must be at least 1');
  const maxMinutes = values['max-minutes'] === undefined ? null : number('max-minutes');
  const settings = { model: values.model ?? null, sessions, rounds, requests: sessions * rounds, gapMs: number('gap-ms'), timeoutMs: number('timeout-ms'),
    maxMinutes, promptSource, promptIds: prompts.map(item => item.id) };
  const startedAt = new Date().toISOString();
  const load = () => os.loadavg().map(value => Number(value.toFixed(2)));
  const loadAtStart = load();
  const run = await runBurst({ url: values.url, prompts, sessions, rounds, model: settings.model, gapMs: settings.gapMs, timeoutMs: settings.timeoutMs,
    deadline: maxMinutes === null ? null : Date.now() + maxMinutes * 60000, channel: values.channel ?? null, headed: values.headed,
    onResult: row => console.error(`r${String(row.round + 1).padStart(2)} s${row.session + 1} ${row.completed ? 'ok  ' : 'FAIL'} first character ${row.firstTokenMs ?? '-'} ms, end ${row.stages.endMs ?? '-'} ms${row.failure ? `, ${row.failure}: ${row.statusText.slice(0, 80)}` : ''}`),
    onRound: entry => console.error(`round ${entry.round + 1}: ${entry.sent} sent within ${entry.sendSpreadMs} ms, load ${entry.requesterLoad.join(' ')}`) });
  const host = new URL(values.url).hostname;
  const summary = run.notStarted ? { requests: 0, verdict: `not started: ${run.notStarted}` }
    : run.wrongModel ? { ...summarizeBurst(run.results), verdict: `wrong model, stopped at ${run.wrongModel}` } : summarizeBurst(run.results);
  const receipt = { schema: 'reploid.pilot-reliability-browser-burst/v1', startedAt, finishedAt: new Date().toISOString(), label: values.label, rule: RULE,
    page: ['127.0.0.1', 'localhost', '[::1]'].includes(host) ? 'local page' : 'deployed page (address not recorded)', answerOn: run.setups[0]?.answerOn ?? null,
    settings, node: process.version, requesterLoad: { cpus: os.cpus().length, start: loadAtStart, end: load() }, setups: run.setups, notStarted: run.notStarted,
    roundsNotRun: run.roundsNotRun, summary, rounds: run.rounds, results: run.results };
  const text = JSON.stringify(receipt, null, 2);
  if (values.out) await fs.writeFile(values.out, `${text}\n`);
  console.log(JSON.stringify({ label: receipt.label, sessions, roundsNotRun: run.roundsNotRun, ...summary }, null, 2));
  process.exitCode = summary.verdict === 'pass' ? 0 : 1;
}

async function main() {
  const { values } = parseArgs({ options: { url: { type: 'string' }, model: { type: 'string' }, requests: { type: 'string', default: String(RULE.minimumRequests) },
    'interval-ms': { type: 'string', default: '25000' }, 'timeout-ms': { type: 'string', default: '120000' }, prompts: { type: 'string' },
    'only-model': { type: 'string' }, channel: { type: 'string' }, headed: { type: 'boolean', default: false }, label: { type: 'string', default: '' },
    out: { type: 'string' }, 'self-check': { type: 'boolean', default: false }, sessions: { type: 'string' }, 'gap-ms': { type: 'string', default: '3000' },
    'max-minutes': { type: 'string' }, 'stub-answer-chars': { type: 'string' }, 'stub-refresh-ms': { type: 'string', default: '0' } } });
  if (values['self-check']) return selfCheck();
  if (!values.url) throw Error('Give --url, or --self-check');
  const number = name => { const value = Number(values[name]); if (!Number.isSafeInteger(value) || value < 0) throw Error(`--${name} must be a whole number`); return value; };
  let prompts = PROMPTS.map((prompt, index) => ({ id: `p${String(index + 1).padStart(2, '0')}`, prompt })), promptSource = 'scripts/pilot/reliability.js PROMPTS';
  if (values.prompts) {
    const file = JSON.parse(await fs.readFile(values.prompts, 'utf8'));
    prompts = file.prompts.filter(item => !values['only-model'] || item.model === values['only-model']).map(item => ({ id: item.id, prompt: item.prompt }));
    promptSource = `file with ${file.prompts.length} prompts${values['only-model'] ? `, ${prompts.length} for the chosen model` : ''}`;
  }
  if (values.sessions !== undefined) return mainBurst(values, number, prompts, promptSource);
  const requests = number('requests');
  const list = Array.from({ length: requests }, (_, index) => prompts[index % prompts.length]);
  const host = new URL(values.url).hostname, local = ['127.0.0.1', 'localhost', '[::1]'].includes(host);
  const stub = values['stub-answer-chars'] === undefined ? null : { answerChars: number('stub-answer-chars'), refreshMs: number('stub-refresh-ms') };
  if (stub && !local) throw Error('--stub-answer-chars replaces the page\'s host and is for a local page only');
  const settings = { model: values.model ?? null, requests, intervalMs: number('interval-ms'), timeoutMs: number('timeout-ms'), promptSource, ...(stub ? { stub } : {}) };
  const startedAt = new Date().toISOString();
  // The requester's own load: a busy machine can delay the page's clock and rendering, so the receipt keeps it.
  const load = () => os.loadavg().map(value => Number(value.toFixed(2)));
  const loadAtStart = load();
  const run = await runBrowserPilot({ url: values.url, prompts: list, model: settings.model, intervalMs: settings.intervalMs, timeoutMs: settings.timeoutMs,
    channel: values.channel ?? null, headed: values.headed, stub,
    onResult: row => console.error(`${String(row.index + 1).padStart(3)} ${row.completed ? 'ok  ' : 'FAIL'} first character ${row.firstTokenMs ?? '-'} ms, end ${row.stages.endMs} ms, main thread ${row.mainThread?.taskMs ?? '-'} ms (before Send ${row.mainThread?.prepareTaskMs ?? '-'} ms)${row.failure ? `, ${row.failure}: ${row.statusText.slice(0, 80)}` : ''}`) });
  const receipt = { schema: 'reploid.pilot-reliability-browser/v1', startedAt, finishedAt: new Date().toISOString(), label: values.label, rule: RULE,
    page: local ? stub ? 'local page, scripted executor (no provider)' : 'local page' : 'deployed page (address not recorded)', answerOn: run.answerOn, settings,
    node: process.version, requesterLoad: { cpus: os.cpus().length, start: loadAtStart, end: load() }, setup: run.setup, notStarted: run.notStarted,
    summary: run.notStarted ? { requests: 0, verdict: `not started: ${run.notStarted}` }
      // A run that would have measured another model has no verdict on this one.
      : run.wrongModel ? { ...summarize(run.results), verdict: `wrong model, stopped at ${run.wrongModel}` } : summarize(run.results),
    mainThread: summarizeMainThread(run.results), results: run.results };
  const text = JSON.stringify(receipt, null, 2);
  if (values.out) await fs.writeFile(values.out, `${text}\n`);
  console.log(JSON.stringify({ label: receipt.label, answerOn: receipt.answerOn, ...receipt.summary, mainThread: receipt.mainThread }, null, 2));
  process.exitCode = receipt.summary.verdict === 'pass' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
