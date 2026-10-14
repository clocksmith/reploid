// Run-7 read-only diagnostic: appends the stage 0 coordinator page's console messages and page errors,
// with timestamps, to a log. The room token is redacted before writing. Runs until killed.
// Usage: node coordinator-console.mjs <cdp endpoint> <origin> <room file> <log>
import fs from 'node:fs';
import { chromium } from 'playwright';
import { findPage } from '../../harness.mjs';
const [endpoint, origin, roomFile, logPath] = process.argv.slice(2);
const token = JSON.parse(fs.readFileSync(roomFile, 'utf8')).token;
const out = fs.createWriteStream(logPath, { flags: 'a' });
const write = (kind, text) => out.write(`${new Date().toISOString()} ${kind} ${String(text).replaceAll(token, '[REDACTED]').slice(0, 2000)}\n`);
const browser = await chromium.connectOverCDP(endpoint);
const page = findPage(browser, origin);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Runtime.enable');
cdp.on('Runtime.consoleAPICalled', event => write(event.type, event.args.map(arg => arg.value ?? arg.description ?? '').join(' ')));
cdp.on('Runtime.exceptionThrown', event => write('exception', event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text));
write('attached', origin);
setInterval(() => {}, 60000);
