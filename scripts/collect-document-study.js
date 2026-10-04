/** Merge explicitly supplied participant files. Never treats browser fixtures as people. */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const directory = process.argv[2];
if (!directory) throw Error('Usage: node scripts/collect-document-study.js <feedback-directory>');
const participants = new Map();
for (const name of (await readdir(directory)).filter(name => name.endsWith('.json')).sort()) {
  const row = JSON.parse(await readFile(resolve(directory, name), 'utf8'));
  if (row.schema !== 'reploid.document-study/v1' || row.consent !== true || row.task !== 'fictional-contractor-comparison'
    || !/^[A-Za-z0-9_-]{1,32}$/.test(row.answers?.participant || '') || !Number.isFinite(Date.parse(row.finishedAt))) throw Error(`Invalid study receipt: ${name}`);
  for (const [field, allowed] of Object.entries({ completed: ['yes', 'partly', 'no'], sources: ['yes', 'partly', 'no'], saved: ['yes', 'no'], returnIntent: ['yes', 'maybe', 'no'] })) {
    if (!allowed.includes(row.answers[field])) throw Error(`Invalid ${field}: ${name}`);
  }
  for (const field of ['hesitations', 'outcome']) if (typeof row.answers[field] !== 'string' || row.answers[field].length > 4000) throw Error(`Invalid ${field}: ${name}`);
  const previous = participants.get(row.answers.participant);
  if (!previous || Date.parse(previous.finishedAt) < Date.parse(row.finishedAt)) participants.set(row.answers.participant, row);
}
const rows = [...participants.values()];
const count = (field, value) => rows.filter(row => row.answers[field] === value).length;
console.log(JSON.stringify({ schema: 'reploid.document-study-summary/v1', participants: rows.length,
  targetParticipants: 10, recruitmentComplete: rows.length >= 10,
  completed: count('completed', 'yes'), sourceCheckSucceeded: count('sources', 'yes'), saved: count('saved', 'yes'),
  returnIntent: { yes: count('returnIntent', 'yes'), maybe: count('returnIntent', 'maybe'), no: count('returnIntent', 'no') },
  evidenceScope: 'Participant self-reports; organizer must separately confirm uncoached observation. Return intent is not measured repeat use.',
  feedback: rows.map(row => row.answers) }, null, 2));
