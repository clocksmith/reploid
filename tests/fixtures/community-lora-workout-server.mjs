/** Serve the shipped browser tree and a preverified, provisioned training model on loopback. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { resolveServedFile, serveBrowserTree } from '../../server/browser-tree.js';
import policy from '../../apps/poolday/config/lora-training.json' with { type: 'json' };
import hosting from '../../deploy/firebase-reploid.template.json' with { type: 'json' };
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };

const [directory, port = '18383'] = process.argv.slice(2);
assert(directory, 'Supply a directory containing the provisioned weight shards and tokenizer');
const redirect = hosting.hosting.flatMap(target => target.redirects || [])
  .find(row => row.source === policy.modelPath + 'manifest.json');
const manifestFile = resolveServedFile(redirect.destination);
const manifestBytes = await readFile(manifestFile);
const manifest = JSON.parse(manifestBytes);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(path.basename(manifestFile), digest(manifestBytes) + '.json');
const release = catalog.find(model => model.supersedes?.some(entry => entry.identity === 'sha256:' + digest(manifestBytes)));
const tokenizer = release.source.files.find(file => file.role === 'tokenizer');
const assets = new Map();
for (const { filename, hash } of [...manifest.shards, { filename: tokenizer.path, hash: tokenizer.hash }]) {
  const file = path.resolve(directory, filename);
  const actual = createHash('sha256');
  for await (const chunk of createReadStream(file)) actual.update(chunk);
  assert.equal(actual.digest('hex'), hash, 'Provisioned training asset differs: ' + filename);
  assets.set(filename, file);
}
const app = express();
const qualificationPage = fileURLToPath(new URL('./lora-workout.html', import.meta.url));
app.get(['/', '/improve'], (req, res) => {
  const qualification = req.path === '/improve' && req.query.qualification === 'lora';
  res.set('Referrer-Policy', 'no-referrer');
  res.sendFile(qualification ? qualificationPage : resolveServedFile('pool-entry.html'));
});
app.get(policy.modelPath + 'manifest.json', (_req, res) => res.sendFile(manifestFile));
app.get(policy.modelPath + ':asset', (req, res) => {
  const file = assets.get(req.params.asset);
  if (file) res.sendFile(file);
  else res.sendStatus(404);
});
app.use(serveBrowserTree());
app.listen(Number(port), '127.0.0.1', () => console.log('Serving the pinned training model and /improve on port', port));
