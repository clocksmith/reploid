// Read-only diagnostic: in one fresh browser context, do two tabs of the same origin each connect and
// expose a custody owner? No send, no contribution. Usage: node probe-second-tab.mjs <cdp> <origin> <room file> <out>
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { observeChat, observeCustody } from '../../observe.mjs';
import { appUrl, openApp, sleep } from '../../harness.mjs';
const [endpoint, origin, roomFile, out] = process.argv.slice(2);
const room = JSON.parse(await fs.readFile(roomFile, 'utf8'));
const browser = await chromium.connectOverCDP(endpoint);
const context = await browser.newContext();
const result = { at: new Date().toISOString(), tabs: [] };
try {
  const pages = [];
  for (const name of ['probe-a', 'probe-b']) { const page = await context.newPage(); await openApp(page, appUrl(origin, room, null), 120000); pages.push([name, page]); }
  await sleep(45000);
  for (const [name, page] of pages) {
    const row = { name };
    row.network = await page.evaluate(() => null);
    try { const chat = await observeChat(page); row.requesterPeerId = chat.requesterPeerId; row.instanceId = chat.instanceId; } catch (e) { row.chatError = e.message; }
    try {
      row.consumer = await page.evaluate(async () => {
        const url = new URL(location.href); return { instanceParam: url.searchParams.get('instance') };
      });
    } catch {}
    try { const c = await observeCustody(page); row.custody = { receipts: c.receipts.length, sharing: c.state.sharing }; } catch (e) { row.custodyError = e.message; }
    result.tabs.push(row);
  }
  // Network/connection state through the same read-only session accessor the harness uses.
  const { observeNetwork } = await import('../../observe.mjs');
  for (const [i, [, page]] of pages.entries()) {
    try { const n = await observeNetwork(page); result.tabs[i].networkState = { consumerPeerId: n.consumerPeerId, paused: n.paused, error: n.error, files: n.files ? { sharing: n.files.sharing, error: n.files.error ?? null } : null }; }
    catch (e) { result.tabs[i].networkError = e.message; }
  }
} finally {
  await fs.writeFile(out, JSON.stringify(result, null, 1).replaceAll(room.token, '[REDACTED]'), { flag: 'wx' });
  await context.close(); await browser.close();
}
console.log(JSON.stringify(result).replaceAll(room.token, '[REDACTED]'));
