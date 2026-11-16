// @vitest-environment node
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as acorn from 'acorn';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('../../shared/core/verification-worker.js', import.meta.url), 'utf8');
async function verify(code) {
  let result;
  const self = { location: { href: 'https://example.test/core/verification-worker.js' }, postMessage: value => { result = value; } };
  vm.runInNewContext(source, { self, URL, TextEncoder, crypto: webcrypto, acorn, importScripts() {} });
  await self.onmessage({ data: { type: 'VERIFY', snapshot: { '/capabilities/example.js': code } } });
  return result;
}

describe('actual Verification Worker prototype detection', () => {
  it('allows a defensive blacklist and comments as data', async () => {
    const result = await verify("// Refuse __proto__ writes\nconst unsafe = new Set(['__proto__', 'constructor', 'prototype']); export const refuses = key => unsafe.has(key);");
    expect(result.passed).toBe(true);
  });

  it.each([
    'const target = {}; target.__proto__ = {};',
    "const target = {}; target['__proto__'] = {};",
    "const target = {}; target['__' + 'proto__'] = {};",
    "const target = {}; target['\\u005f\\u005fproto__'] = {};",
    "const target = { ['__proto__']: {} };",
    "const key = '__proto__'; const target = {}; target[key] = {};",
    "const prefix = '__'; const key = prefix + 'proto__'; const target = {}; target[key] = {};",
    "let key; key = '__proto__'; Reflect.set({}, key, {});",
    "Reflect.set({}, '__proto__', {});",
    "Object.defineProperty({}, '__proto__', { value: {} });"
  ])('rejects prototype access: %s', async code => {
    const result = await verify(code);
    expect(result.passed).toBe(false);
    expect(result.details.patternViolations).toContainEqual(expect.objectContaining({ patternId: 'proto_access' }));
  });
});
