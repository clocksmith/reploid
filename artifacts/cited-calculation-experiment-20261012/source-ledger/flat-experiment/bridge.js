import { calculateFlatLedger } from './adapter.js';
import { renderLedger } from '../render.js';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { selection, messages, maxCharacters } = JSON.parse(input);
try {
  const ledger = await calculateFlatLedger(selection, messages);
  const report = renderLedger(ledger, { maxCharacters });
  console.log(JSON.stringify({ ok: true, ledger, report }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
}
