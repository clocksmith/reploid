/** Opt-in local collection: no telemetry or conversation/document extraction. */
const key = 'reploid.document-study:v1';
const form = document.querySelector('#feedback'), status = document.querySelector('#status');
let startedAt = null;
try { startedAt = JSON.parse(localStorage.getItem(key) || 'null')?.startedAt || null; } catch { /* No automatic submission. */ }
document.querySelector('#start').addEventListener('click', () => {
  startedAt = new Date().toISOString();
  try { localStorage.setItem(key, JSON.stringify({ startedAt })); } catch { /* The open page retains its start time. */ }
  window.open('/', '_blank', 'noopener');
  status.textContent = 'When you finish or stop, return here to record your experience.';
});
form.addEventListener('submit', event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const fields = new FormData(form), finishedAt = new Date().toISOString();
  const answers = Object.fromEntries(['participant', 'completed', 'sources', 'saved', 'returnIntent', 'hesitations', 'outcome'].map(name => [name, fields.get(name)]));
  const receipt = { schema: 'reploid.document-study/v1', task: 'fictional-contractor-comparison',
    startedAt, finishedAt, elapsedMs: startedAt ? Date.parse(finishedAt) - Date.parse(startedAt) : null,
    timingScope: 'self-directed task and questionnaire; not model latency', consent: true, answers };
  const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `reploid-study-${answers.participant}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  status.textContent = 'Feedback downloaded. Send this file to your study organizer. Nothing was uploaded.';
});
