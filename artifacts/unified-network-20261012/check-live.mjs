import http from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Serve the existing local application at two real, independently assigned ports.
// No contribution, request submission or model execution is enabled by this probe.
const servers = [];
const report = { at: new Date().toISOString(), scope: 'Live browser discovery across hosted and loopback page origins', pages: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const urls = ['https://replo.id/'];
  for (const host of ['localhost', '127.0.0.1']) {
    const server = http.createServer((request, response) => {
      const upstream = http.request({ host: '127.0.0.1', port: 8000, path: request.url, method: request.method }, source => {
        response.writeHead(source.statusCode, source.headers); source.pipe(response);
      });
      upstream.on('error', () => { response.writeHead(502); response.end(); });
      request.pipe(upstream);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); servers.push(server);
    urls.push(`http://${host}:${server.address().port}/`);
  }
  for (const url of urls) {
    const page = await browser.newPage(); const weightRequests = []; const errors = []; const sockets = []; const signaling = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (['error','warning'].includes(m.type()) && errors.length < 20) errors.push(m.text().slice(0,600)); });
    page.on('websocket', s => {
      sockets.push(s.url());
      s.on('socketerror', e => { if (signaling.length < 20) signaling.push({ error: String(e) }); });
      s.on('framereceived', f => { try { const m=JSON.parse(f.payload); if(signaling.length<20) signaling.push({ type:m.type, error:m.error, peerId:m.peerId }); } catch {} });
      s.on('framesent', f => { try { const m=JSON.parse(f.payload); if(m.type==='join' && signaling.length<20) signaling.push({ sent:m.type, peerId:m.peerId, roomId:m.roomId }); } catch {} });
    });
    page.on('request', request => { if (/\.(?:bin|safetensors|gguf)(?:\?|$)/.test(request.url())) weightRequests.push(request.url()); });
    await page.goto(url);
    await page.locator('[data-toggle-inspector]').click({ timeout: 30000 });
    let failed;
    try { await page.waitForFunction(() => [...document.querySelectorAll('[data-insp-device-list] li')].filter(row => /ready/i.test(row.textContent)).length >= 2, null, { timeout: 20000 }); } catch (e) { failed = e; }
    report.pages.push(await page.evaluate(() => ({ origin: location.origin,
      connection: document.querySelector('[data-connection-label]')?.textContent,
      peers: [...document.querySelectorAll('[data-insp-device-list] li')].map(row => ({ identity: row.querySelector('code')?.textContent, text: row.textContent })) })));
    Object.assign(report.pages.at(-1), { weightRequests, errors, sockets, signaling });
    console.log(JSON.stringify(report.pages.at(-1)));
    if (failed) throw failed;
  }
  const ready = report.pages.map(page => page.peers.filter(peer => /ready/i.test(peer.text)).map(peer => peer.identity));
  report.commonReadyParticipants = ready[0].filter(id => ready.every(ids => ids.includes(id)));
  if (!report.commonReadyParticipants.length || report.pages.some(page => page.weightRequests.length)) throw new Error('Shared prepared participants or weightless discovery check failed');
  report.passed = true;
} catch (error) { report.passed = false; report.error = error.message; process.exitCode = 1; }
finally {
  await browser.close(); for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await writeFile(new URL('./live-discovery.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, origins: report.pages.map(page => page.origin), commonReadyParticipants: report.commonReadyParticipants, error: report.error }));
}
