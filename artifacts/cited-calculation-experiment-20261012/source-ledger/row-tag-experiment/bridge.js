import { calculateRows } from './adapter.js';
let text = '';
for await (const chunk of process.stdin) text += chunk;
try {
  const { selection, messages } = JSON.parse(text);
  const ledger = await calculateRows(selection, messages);
  // Reuse the retained bridge envelope validator; no rendered answer is produced.
  console.log(JSON.stringify({ ok: true, ledger, report: { text: '' } }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
}
