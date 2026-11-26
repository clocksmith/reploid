#!/usr/bin/env node
/**
 * Walk the first-visit journeys (docs/first-visit-journeys.md) on a served site the way a new visitor would: a
 * fresh browser profile, nothing downloaded, the question typed and Send pressed, and nothing else. It exists
 * because nothing else notices when that stops working: a deploy that changes model identities disconnects every
 * provider still on an older package while the page still loads, and a default that asks the visitor to choose
 * a computer or names one model while another answers passes every other check.
 *
 *   node scripts/verify-public-answer.js [--url https://replo.id] [--viewport mobile|desktop] [--follow-up]
 *     [--timeout-seconds 180] [--channel chrome] [--screenshots DIR]
 *
 * Prints one JSON line. Exit 0 only when all of these held:
 *   - an answer completed after exactly one press (Send): no sheet, permission prompt, Join step or payment text;
 *   - the model the composer named before Send, the model the answer row names, the conversation's model and the
 *     model identity in the stored execution record (read from Settings, "Export my data") are the same; a
 *     provider-signed receipt, when the provider sent one, verifies and names that identity too (`receipt` says
 *     which of these was the case);
 *   - with --follow-up, a second message in the same conversation completed on the same model;
 *   - the Computers view lists the ready computers with what each serves, shows where to contribute, shows this
 *     device as not sharing, and leaves Send usable.
 * `failed` lists what did not hold. Contribution is never started: the script reads the choices and stops.
 * Each run sends one fixed public prompt (two with --follow-up) to a public computer.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { verifyReceipt } from '../packages/reploid/src/artifacts/receipt.js';

const { values } = parseArgs({ options: { url: { type: 'string', default: 'https://replo.id' },
  'timeout-seconds': { type: 'string', default: '180' }, channel: { type: 'string' },
  viewport: { type: 'string', default: 'mobile' }, 'follow-up': { type: 'boolean', default: false }, screenshots: { type: 'string' } } });
const limitMs = Number(values['timeout-seconds']) * 1000;
if (!Number.isFinite(limitMs) || limitMs <= 0) throw new Error('--timeout-seconds must be a positive number');
if (!['mobile', 'desktop'].includes(values.viewport)) throw new Error('--viewport must be mobile or desktop');
const PROMPT = 'Name the capital of France in one word.', FOLLOW_UP = 'And of Italy, in one word?';
const ENDED = /^(Complete|Failed|Stopped|Interrupted|Disconnected)\b/;

/** What the page tells the visitor now, read in the page. */
function readPage() {
  const doc = globalThis.document, one = selector => doc.querySelector(selector);
  const shown = node => Boolean(node) && node.getClientRects().length > 0;
  const text = node => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rows = [...doc.querySelectorAll('[data-message-stream] [data-message-role=assistant]')];
  const last = rows.at(-1);
  return {
    at: Math.round(globalThis.performance.now()),
    computer: text(one('[data-composer-model-source]')), model: text(one('[data-composer-model-name]')),
    chip: one('[data-open-model]')?.getAttribute('aria-label') ?? '',
    whoCanRead: one('[data-open-privacy]')?.getAttribute('aria-label') ?? '', disclosure: text(one('[data-prompt-disclosure]')),
    status: text(one('[data-model-status]')), sendUsable: shown(one('[data-composer-send]')) && !one('[data-composer-send]').disabled,
    dialogs: [...doc.querySelectorAll('dialog[open]')].map(node => text(node.querySelector('h1,h2,h3,[data-picker-title]')) || text(node).slice(0, 80)),
    permission: shown(one('[data-remote-permission] [data-remote-permission-allow]')), join: shown(one('[data-join-host]')),
    answers: rows.length,
    answer: last ? { activity: (last.querySelector('[data-execution-trigger]')?.getAttribute('aria-label') ?? '').replace(/\. Execution details$/, ''),
      line: text(last.querySelector('[data-execution-activity]')), system: text(last.querySelector('[data-system-status]')),
      chars: text(last.querySelector('.pool-prose')).length, text: text(last.querySelector('.pool-prose')).slice(0, 120) } : null
  };
}

/**
 * The stored record of the newest conversation, from the page's own export (Settings, "Export my data"): the
 * conversation's model and, per attempt, the model requested, the model the execution record says ran, and the receipt.
 */
async function readRecord(page) {
  await page.locator('[data-workspace-view=settings]').click();
  const control = page.locator('[data-data-export]');
  await control.waitFor({ state: 'visible', timeout: 15000 });
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), control.click()]);
  const file = JSON.parse(await readFile(await download.path(), 'utf8'));
  await page.locator('[data-close-inspector]:visible').first().click();
  const recent = thread => thread.attempts?.at(-1)?.createdAt ?? 0;
  const thread = [...(file.conversations ?? [])].sort((a, b) => recent(b) - recent(a))[0];
  if (!thread?.attempts?.length) return null;
  return { conversation: { id: thread.model?.id ?? null, name: thread.model?.name ?? null, identity: thread.model?.identity ?? null },
    attempts: thread.attempts.map(attempt => ({ status: attempt.status,
      requested: { id: attempt.request?.model?.id ?? null, identity: attempt.request?.model?.identity ?? null },
      executed: { id: attempt.execution?.modelId ?? null, identity: attempt.execution?.modelIdentity ?? null, placement: attempt.execution?.placement ?? null },
      receipt: attempt.execution?.executionReceipt ?? null })) };
}

const browser = await chromium.launch(values.channel ? { channel: values.channel } : {});
const result = { url: values.url, viewport: values.viewport, ok: false, stage: 'open', failed: [], presses: 0, model: null, answer: null, seconds: null };
const fail = what => { result.failed.push(what); };
let shots = 0;
try {
  const mobile = values.viewport === 'mobile';
  const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const shot = async name => {
    if (!values.screenshots) return;
    await mkdir(values.screenshots, { recursive: true });
    await page.screenshot({ path: resolve(values.screenshots, `${values.viewport}-${String(++shots).padStart(2, '0')}-${name}.png`) });
  };
  const press = async locator => { result.presses++; await locator.click(); };
  /** Waits for the newest answer to end and returns the page as it then reads. */
  const waitForAnswer = async count => {
    await page.waitForFunction(({ count, ended }) => {
      const rows = [...globalThis.document.querySelectorAll('[data-message-stream] [data-message-role=assistant]')];
      return rows.length >= count && new RegExp(ended).test(rows.at(-1).querySelector('[data-execution-trigger]')?.getAttribute('aria-label') ?? '');
    }, { count, ended: ENDED.source }, { timeout: limitMs });
    return page.evaluate(readPage);
  };

  await page.goto(values.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const send = page.locator('[data-composer-send]');
  await send.waitFor({ state: 'visible', timeout: 60000 });
  // Journey 1: the page joins and finds computers by itself. Nothing is pressed while it does.
  result.stage = 'discover';
  await page.waitForFunction(() => {
    const name = globalThis.document.querySelector('[data-composer-model-name]')?.textContent ?? '';
    return name !== '' && !/^Finding computers/.test(name);
  }, null, { timeout: 30000 }).catch(() => {});
  const before = await page.evaluate(readPage);
  result.discoveryMs = before.at;
  result.before = { computer: before.computer, model: before.model, chip: before.chip, whoCanRead: before.whoCanRead,
    disclosure: before.disclosure, status: before.status, sendUsable: before.sendUsable };
  await shot('before-send');
  if (before.join) fail('a Join step is shown before the first question');
  if (before.dialogs.length) fail(`a dialog is open before the first question: ${before.dialogs[0]}`);
  if (/credit|cost|pay|budget|spending/i.test(`${before.status} ${before.disclosure}`)) fail('the composer mentions a charge before the first question');
  if (!before.sendUsable) fail(`Send is not usable for a first visitor: ${before.status || before.chip}`);

  // Journey 2: type and send, nothing else. The question is typed key by key, as a person types it: the page may
  // still be hearing from computers, and the model it names when Send is pressed is the one that must answer.
  result.stage = 'send';
  await page.locator('[data-composer-input]').pressSequentially(PROMPT, { delay: 40 });
  const typed = await page.evaluate(readPage);
  result.atSend = { at: typed.at, computer: typed.computer, model: typed.model, disclosure: typed.disclosure };
  const started = Date.now();
  await press(send);
  const picker = page.locator('[data-model-picker]');
  const asked = await page.waitForFunction(() => globalThis.document.querySelector('[data-model-picker]')?.open
    || globalThis.document.querySelector('[data-message-stream] [data-message-role=assistant]'), null, { timeout: 30000 })
    .then(() => picker.evaluate(node => node.open), () => false);
  if (asked) {
    // The journey has already failed: the visitor is asked to choose. The check still follows the sheet, as a person
    // would, to report whether a public computer could have answered.
    result.stage = 'choose-computer';
    fail(`Send asked the visitor to choose: ${(await page.locator('[data-picker-title]').innerText().catch(() => 'a sheet')).trim()}`);
    await shot('asked-to-choose');
    const contributors = page.locator('[data-execution-choice=network]');
    if (!await contributors.locator('input').isChecked()) await press(contributors);
    const commit = page.locator('[data-change-model]');
    const ready = await page.waitForFunction(() => {
      const button = globalThis.document.querySelector('[data-change-model]');
      return button && !button.disabled && /^Send\b/.test(button.textContent.trim());
    }, null, { timeout: 30000 }).then(() => true, () => false);
    if (!ready) throw new Error(`No public computer serves the default model [${(await commit.innerText()).trim()}]`);
    await press(commit);
  }
  result.stage = 'answer';
  const sent = await page.evaluate(readPage);
  result.model = sent.chip;
  if (sent.permission) fail('a permission prompt stands between Send and the answer');
  const answered = await waitForAnswer(1);
  result.seconds = Math.round((Date.now() - started) / 100) / 10;
  result.answer = answered.answer;
  await shot('first-answer');
  if (!/^Complete\b/.test(answered.answer.activity) || answered.answer.chars === 0 || answered.answer.system) {
    throw new Error(`The answer did not complete: ${answered.answer.activity} ${answered.answer.system}`.trim());
  }
  if (result.presses !== 1) fail(`${result.presses} presses were needed between the typed question and the answer; the bar is one (Send)`);

  if (values['follow-up']) {
    result.stage = 'follow-up';
    await page.locator('[data-composer-input]').fill(FOLLOW_UP);
    await send.click();
    const second = await waitForAnswer(2);
    result.followUp = { activity: second.answer.activity, line: second.answer.line, chars: second.answer.chars, dialogs: second.dialogs };
    await shot('follow-up');
    if (!/^Complete\b/.test(second.answer.activity) || second.answer.chars === 0) fail(`the follow-up did not complete: ${second.answer.activity} ${second.answer.system}`.trim());
    if (second.dialogs.length) fail(`the follow-up opened a dialog: ${second.dialogs[0]}`);
    if (second.answer.line !== answered.answer.line) fail(`the follow-up's answer row reads "${second.answer.line}", the first "${answered.answer.line}"`);
  }

  // The model named before Send, on the answer, in the conversation and in each execution record must be one model.
  result.stage = 'record';
  const record = await readRecord(page).catch(() => null);
  const named = asked ? sent.model : typed.model;
  result.served = { namedBeforeSend: named, answerRow: answered.answer.line, conversation: record?.conversation ?? null,
    executed: record?.attempts.map(attempt => attempt.executed) ?? null };
  if (!record) fail('the stored conversation record could not be read, so the answering model is not checked');
  else {
    if (!asked && typed.computer !== 'Contributors') fail(`the composer named ${typed.computer || 'no computer'} before Send, and a public computer answered`);
    if (record.conversation.name !== named) fail(`the composer named ${named} and the conversation ran ${record.conversation.name}`);
    if (!answered.answer.line.includes(record.conversation.name)) fail(`the answer row does not name ${record.conversation.name}: ${answered.answer.line}`);
    if (record.attempts.length !== (values['follow-up'] ? 2 : 1)) fail(`the conversation holds ${record.attempts.length} attempts`);
    result.receipts = [];
    for (const attempt of record.attempts) {
      if (!attempt.executed.identity || attempt.executed.identity !== record.conversation.identity || attempt.requested.identity !== record.conversation.identity) {
        fail(`an execution record names model identity ${attempt.executed.identity}, not the conversation's ${record.conversation.identity}`);
      }
      const receipt = attempt.receipt;
      if (!receipt) { result.receipts.push({ present: false, note: 'no provider-signed receipt was stored; the model identity is the provider\'s unsigned reply, checked against the request' }); continue; }
      const checked = await verifyReceipt(receipt).catch(() => ({ providerValid: false }));
      result.receipts.push({ present: true, version: receipt.version, provider: receipt.provider, model: receipt.model, modelIdentity: receipt.modelIdentity ?? null,
        status: receipt.status, outputTokens: receipt.outputTokens, providerSignatureValid: checked.providerValid === true, signsModelIdentity: typeof receipt.modelIdentity === 'string' });
      if (!checked.providerValid) fail('the provider\'s signature on a receipt does not verify');
      if (receipt.model !== record.conversation.id) fail(`a signed receipt names model ${receipt.model}, not ${record.conversation.id}`);
      if (typeof receipt.modelIdentity === 'string' && receipt.modelIdentity !== record.conversation.identity) fail(`a signed receipt names model identity ${receipt.modelIdentity}`);
    }
  }

  // Journeys 3 and 4: the Computers view, from the same page. Nothing is started.
  result.stage = 'computers';
  await page.locator('[data-workspace-view=computers]').click();
  await page.locator('[data-insp-device-list]').waitFor({ state: 'visible', timeout: 15000 });
  await shot('computers');
  result.computers = await page.evaluate(() => {
    const doc = globalThis.document, text = node => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const visible = node => Boolean(node) && node.getClientRects().length > 0;
    const facts = node => Object.fromEntries([...node.querySelectorAll('dl > div')].map(row => [text(row.querySelector('dt')), text(row.querySelector('dd'))]));
    const sendButton = doc.querySelector('[data-composer-send]');
    const centre = sendButton?.getBoundingClientRect();
    const top = centre ? doc.elementFromPoint(centre.x + centre.width / 2, centre.y + centre.height / 2) : null;
    return {
      connection: doc.querySelector('[data-mesh-connect]')?.getAttribute('data-connection-label') ?? '', readiness: text(doc.querySelector('[data-peer-readiness]')),
      listed: [...doc.querySelectorAll('[data-insp-device-list] [data-computer-id]')].filter(visible).map(node => ({
        name: text(node.querySelector('[data-computer-name]')), status: text(node.querySelector('[data-computer-status]')),
        ...Object.fromEntries(Object.entries(facts(node)).filter(([fact]) => /^(Model|Reachable|Ready for |Why not used)/.test(fact))) })),
      contribute: { shown: visible(doc.querySelector('[data-production-device] > summary')), heading: text(doc.querySelector('[data-production-device] > summary')),
        answering: doc.querySelector('[data-toggle-contribution]')?.getAttribute('aria-checked') ?? null,
        state: text(doc.querySelector('[data-this-computer] p')), models: doc.querySelectorAll('[data-production-model]').length },
      sendWhileOpen: !sendButton ? 'absent' : sendButton.disabled ? 'disabled' : top === sendButton || sendButton.contains(top) ? 'usable' : 'covered by the view'
    };
  });
  const view = result.computers;
  if (!view.listed.some(row => row.status === 'Ready' && row.Model)) fail('the Computers view lists no ready computer with what it serves');
  if (!view.contribute.shown || view.contribute.models === 0) fail('the Computers view shows no way to contribute this device');
  if (view.contribute.answering !== 'false') fail('this device is shown as answering requests although the visitor never chose to contribute');
  if (view.sendWhileOpen === 'disabled') fail('Send is disabled while the Computers view is open');
  // On a phone the view covers the page; closing it must return to a usable composer.
  await page.locator('[data-close-inspector]:visible').first().click();
  const after = await page.evaluate(readPage);
  result.computers.sendAfterClose = after.sendUsable ? 'usable' : 'not usable';
  if (!after.sendUsable) fail('Send is not usable after closing the Computers view');

  result.ok = result.failed.length === 0;
  if (result.ok) result.stage = 'complete';
} catch (error) {
  result.error = String(error.message).split('\n')[0].slice(0, 300);
  fail(result.error);
} finally {
  await browser.close();
}
console.log(JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
