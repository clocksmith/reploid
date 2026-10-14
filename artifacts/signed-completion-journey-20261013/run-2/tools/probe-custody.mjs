// Read-only diagnostic: can the harness's observeCustody/observeNetwork read the file owner of a page?
// Usage: node probe-custody.mjs <cdp endpoint> <origin>
import { chromium } from 'playwright';
import { observeCustody, observeNetwork } from '../../observe.mjs';
import { findPage } from '../../harness.mjs';
const [endpoint, origin] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = findPage(browser, origin), out = { at: new Date().toISOString() };
  try { const n = await observeNetwork(page); out.network = { files: n.files ? Object.keys(n.files) : null, consumerPeerId: n.consumerPeerId, contributionPhase: n.contribution?.phase }; } catch (e) { out.networkError = e.message; }
  try { const c = await observeCustody(page); out.custody = { stateKeys: Object.keys(c.state || {}), receipts: c.receipts?.length, receivedBytes: c.state?.receivedBytes }; } catch (e) { out.custodyError = e.message; }
  console.log(JSON.stringify(out));
} finally { await browser.close(); }
