import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { privateAddressReason } from './config.mjs';

const folder = new URL('./', import.meta.url);
const files = fs.readdirSync(folder).filter(name => /\.(mjs|json|md|txt)$/.test(name));
// docs/EMOJI.md tables list approved symbols as "| <symbol> | U+XXXX |".
const approved = new Set([...fs.readFileSync(new URL('../../docs/EMOJI.md', import.meta.url), 'utf8')
  .matchAll(/^\| (\S+) \| U\+[0-9A-F]{4,5} \|/gm)].map(match => match[1]));

test('no file carries a private machine address or login', () => {
  for (const name of files) {
    for (const [index, line] of fs.readFileSync(new URL(name, folder), 'utf8').split('\n').entries()) {
      assert.equal(privateAddressReason(line), null, `${name}:${index + 1}`);
    }
  }
});
test('non-ASCII characters are approved symbols only; no emoji or emdash', () => {
  assert.ok(approved.size > 20);
  for (const name of files) {
    const unexpected = [...fs.readFileSync(new URL(name, folder), 'utf8')].filter(char => char.codePointAt(0) > 0x7e && char !== '\n' && !approved.has(char));
    assert.deepEqual([...new Set(unexpected)], [], name);
  }
});
