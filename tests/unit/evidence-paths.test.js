import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT, expandHomePath, homeRedactingStream, portableEvidence, portablePath, redactHomeText } from '../../scripts/evidence-paths.js';

// A neutral home outside the usual prefixes keeps this test free of real home paths.
const home = path.join(path.sep, 'srv', 'operator');

describe('evidence paths', () => {
  it('replaces the home prefix in plain paths, file URLs and stack text, and leaves look-alikes', () => {
    const text = `at ${home}/deco/a.js:1\nfile://${home}/deco/b.js "cwd": "${home}" ${home}-other ${home}er/x`;
    expect(redactHomeText(text, { home })).toBe(
      `at ~/deco/a.js:1\nfile://~/deco/b.js "cwd": "~" ${home}-other ${home}er/x`);
  });

  it('replaces other users\' homes too: Linux, macOS, ../ chains, escaped slashes and Windows forms', () => {
    // Built from parts so this file carries no literal home path.
    const linux = ['', 'home', 'peer'].join('/'), mac = ['', 'Users', 'peer'].join('/');
    const windows = ['C:', 'Users', 'peer'].join('\\');
    const text = [`${linux}/a.js`, `file://${mac}/b`, `\u001b[90m${linux}/c`, `file:../..${linux}/d`,
      `${linux.replaceAll('/', '\\/')}\\/e`, `${windows}\\f`, windows.replaceAll('\\', '/') + '/g',
      JSON.stringify(`${windows}\\h`)].join(' ');
    expect(redactHomeText(text, { home })).toBe(
      ['~/a.js', 'file://~/b', '\u001b[90m~/c', 'file:~/d', '~\\/e', '~\\f', '~/g', '"~\\\\h"'].join(' '));
  });

  it('leaves URL paths, shared folders and look-alike names alone', () => {
    const url = `http://127.0.0.1:8080${['', 'home', 'peer', 'x'].join('/')}`;
    const shared = ['', 'Users', 'Shared', 'x'].join('/');
    expect(redactHomeText(`${url} ${shared}`, { home })).toBe(`${url} ${shared}`);
    expect(redactHomeText(`${['', 'home', 'peer'].join('/')}. Done`, { home })).toBe('~. Done');
  });

  it('matches a Windows current home in any separator form and letter case', () => {
    const windowsHome = ['C:', 'Users', 'Operator'].join('\\');
    expect(redactHomeText(['c:', 'users', 'operator', 'x'].join('/'), { home: windowsHome })).toBe('~/x');
    expect(redactHomeText(['D:', 'Profiles', 'Operator', 'x'].join('\\\\'), { home: ['D:', 'Profiles', 'Operator'].join('\\') }))
      .toBe('~\\\\x');
  });

  it('writes repo-relative paths inside the checkout and ~/ paths elsewhere under home', () => {
    const root = path.join(home, 'deco', 'reploid');
    expect(portablePath(path.join(root, 'artifacts', 'x.json'), { root, home })).toBe(path.join('artifacts', 'x.json'));
    expect(portablePath(root, { root, home })).toBe('.');
    expect(portablePath(path.join(home, 'deco', 'doppler'), { root, home })).toBe('~/deco/doppler');
    expect(portablePath(path.join(path.sep, 'tmp', 'run'), { root, home })).toBe(path.join(path.sep, 'tmp', 'run'));
    expect(portablePath('relative/path', { root, home })).toBe('relative/path');
    expect(path.isAbsolute(REPOSITORY_ROOT)).toBe(true);
  });

  it('redacts every string and key of a report without changing other values', () => {
    const report = { passed: true, count: 3, config: { modelDirectory: `${home}/models`, list: [`${home}/a`, null] },
      [`${home}/key`]: 'value' };
    expect(portableEvidence(report, { home })).toEqual({ passed: true, count: 3,
      config: { modelDirectory: '~/models', list: ['~/a', null] }, '~/key': 'value' });
  });

  it('resolves ~/ paths read back from evidence under the home directory', () => {
    expect(expandHomePath('~/deco/pack.json', { home })).toBe(path.join(home, 'deco', 'pack.json'));
    expect(expandHomePath('~', { home })).toBe(home);
    expect(expandHomePath('relative/~/x', { home })).toBe('relative/~/x');
    expect(expandHomePath(undefined, { home })).toBe(undefined);
  });

  it('does nothing when the home directory is the filesystem root or missing', () => {
    expect(redactHomeText('/a/b', { home: path.sep })).toBe('/a/b');
    expect(redactHomeText('/a/b', { home: '' })).toBe('/a/b');
  });

  it('redacts captured output even when a path or character is split across chunks', async () => {
    const stream = homeRedactingStream({ home });
    const received = [];
    stream.on('data', chunk => received.push(String(chunk)));
    const bytes = Buffer.from(`one ${home}/a.js\ntwo \u00e9 ${home}/b.js`);
    const split = bytes.indexOf('operator') + 3;
    const accent = bytes.indexOf(0xc3) + 1;
    for (const [start, end] of [[0, split], [split, accent], [accent, bytes.length]]) stream.write(bytes.subarray(start, end));
    stream.end();
    await new Promise(resolve => stream.on('end', resolve));
    expect(received.join('')).toBe('one ~/a.js\ntwo \u00e9 ~/b.js');
  });
});
