#!/usr/bin/env node
import { createNativeRtcRenewal } from './native-rtc-renewal.js';
const directory = process.argv[2];
if (!directory || process.argv.length !== 3) throw new Error('Usage: node server/native-rtc-renewal-cli.js /absolute/private/directory');
const renew = createNativeRtcRenewal(directory);
let stopped = false;
process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });
while (!stopped) {
  let delay = 30000;
  try {
    const { expiresAt } = await renew();
    console.log(JSON.stringify({ event: 'rtc-credentials-renewed', expiresAt }));
    delay = Math.max(1000, Math.min(240000, Date.parse(expiresAt) - Date.now() - 120000));
  } catch { console.error('RTC credential renewal failed; retaining prior file and retrying'); }
  for (let elapsed = 0; !stopped && elapsed < delay; elapsed += 1000) await new Promise(resolve => setTimeout(resolve, 1000));
}
