// @vitest-environment node
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as acorn from 'acorn';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('../../shared/core/verification-worker.js', import.meta.url), 'utf8');
async function verifySnapshot(snapshot) {
  let result;
  const self = { location: { href: 'https://example.test/core/verification-worker.js' }, postMessage: value => { result = value; } };
  vm.runInNewContext(source, { self, URL, TextEncoder, crypto: webcrypto, acorn, importScripts() {} });
  await self.onmessage({ data: { type: 'VERIFY', snapshot } });
  return result;
}
const verify = code => verifySnapshot({ '/capabilities/example.js': code });
const violationIds = result => result.details.patternViolations.map(violation => violation.patternId);
const patternsAt = async (path, code) => violationIds(await verifySnapshot({ [path]: code }));

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

describe('actual Verification Worker dangerous patterns by path', () => {
  const tool = '/tools/BadTool.js';
  it.each([
    ['eval', 'export default () => eval("1+1");'],
    ['eval', 'export default () => eval  (  "code"  );'],
    ['function_constructor', 'export default () => new Function("return 1");'],
    ['dynamic_import', 'export default async () => import("./module.js");'],
    ['constructor_prototype', 'export default obj => { obj.constructor.prototype.polluted = true; };'],
    ['constructor_prototype', 'export default obj => { obj.constructor["prototype"].x = 1; };'],
    ['fetch', 'export default () => fetch("https://evil.com");'],
    ['localstorage', 'export default () => localStorage.setItem("key", "value");'],
    ['localstorage', 'export default () => { localStorage["key"] = "value"; };'],
    ['document_write', 'export default () => document.write("<b>x</b>");'],
    ['process_env', 'export default () => process.env.API_KEY;'],
    ['require', 'export default () => require("fs");'],
    ['while_true', 'export default () => { while(true) { step(); } };']
  ])('flags %s in a tool', async (id, code) => {
    const result = await verifySnapshot({ [tool]: code });
    expect(result.passed).toBe(false);
    expect(violationIds(result)).toContain(id);
  });

  it('flags child_process in a tool', async () => {
    const ids = await patternsAt(tool, 'export default () => require("child_process");');
    expect(ids.some(id => id === 'child_process' || id === 'require')).toBe(true);
  });

  it('warns on innerHTML assignment without failing the tool', async () => {
    const result = await verifySnapshot({ '/tools/Tool.js': 'export default (element, html) => { element.innerHTML = html; };' });
    expect(result.passed).toBe(true);
    expect(result.details.patternViolations).toContainEqual(expect.objectContaining({ patternId: 'innerhtml_assign', severity: 'warning' }));
  });

  it('lets core modules use eval and fetch, which their capabilities grant', async () => {
    expect(await patternsAt('/core/eval-helper.js', 'export const run = () => eval("1+1");')).not.toContain('eval');
    expect(await patternsAt('/core/api-client.js', 'export const get = () => fetch("https://api.example.com");')).not.toContain('fetch');
  });

  it.each([
    ['eval', 'export default function evaluate(x) { return x * 2; }'],
    ['fetch', 'export default async function fetchData() { return 1; }']
  ])('does not flag %s for a similarly named function', async (id, code) => {
    expect(await patternsAt('/tools/Tool.js', code)).not.toContain(id);
  });
});

describe('actual Verification Worker capability boundaries', () => {
  const writesFrom = async (path, target) => {
    const result = await verifySnapshot({ [path]: `export default async VFS => VFS.write('${target}', 'x');` });
    return result.errors.some(error => error.startsWith(`Capability Violation in ${path}`));
  };

  it.each([
    ['/tools/MyTool.js', '/tools/NewTool.js', false],
    ['/tools/MyTool.js', '/apps/MyApp.js', false],
    ['/tools/MyTool.js', '/.logs/debug.log', false],
    ['/tools/MyTool.js', '/core/agent-loop.js', true],
    ['/tools/MyTool.js', '/infrastructure/event-bus.js', true],
    ['/apps/MyApp.js', '/tools/MyTool.js', true],
    ['/core/module.js', '/tools/MyTool.js', false],
    ['/core/module.js', '/infrastructure/x.js', false],
    ['/infrastructure/module.js', '/core/other.js', false]
  ])('%s writing %s is a violation: %s', async (path, target, violates) => {
    expect(await writesFrom(path, target)).toBe(violates);
  });
});

describe('actual Verification Worker complexity heuristics', () => {
  const complexity = async code => (await verifySnapshot({ '/tools/Tool.js': `export default 1;\n${code}` }))
    .details.complexityWarnings.map(warning => warning.metric);

  it('warns past the line, function and nesting limits only', async () => {
    const lines = count => Array.from({ length: count }, (_, i) => `const x${i} = ${i};`).join('\n');
    expect(await complexity(lines(400))).not.toContain('lines');
    expect(await complexity(lines(600))).toContain('lines');
    expect(await complexity(Array.from({ length: 25 }, (_, i) => `function fn${i}() {}`).join('\n'))).toContain('functions');
    expect(await complexity('function f() { if (a) { if (b) { if (c) { if (d) { if (e) { if (g) {} } } } } } }')).toContain('nesting');
    expect(await complexity('function f() { if (a) { for (;;) { while (x) {} } } }')).not.toContain('nesting');
  });

  it('ignores braces inside strings and comments when measuring nesting', async () => {
    expect(await complexity('const s = "{{{{{{{{";\n// {{{{{{{{\n/* {{{{{{{{ */\nfunction f() {}')).not.toContain('nesting');
  });
});
