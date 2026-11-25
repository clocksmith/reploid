import { describe, expect, it } from 'vitest';
import { nativeCommand } from '../../server/native-node-commands.js';
import { DEFAULT_MODEL, nodeArguments, participantProcessArgv } from '../../server/native-node.js';

const TWO_B = 'qwen-3-5-2b-q4k-ef16-af32';
import { homePathFindings, nativePackageManifest } from '../../scripts/package-native.js';

describe('reploid <model>: the short native command', () => {
  it('serves the default model when no model id is given, keeping any options', () => {
    // The smallest catalog model, which most computers can serve.
    expect(DEFAULT_MODEL).toBe('qwen-3-5-0-8b-q4k-ef16-af32-vf16');
    expect(nodeArguments([], { home: '/h' }).args).toEqual(nodeArguments([DEFAULT_MODEL], { home: '/h' }).args);
    const withOption = nodeArguments(['--connect-only'], { home: '/h' });
    expect(withOption.model).toBe(DEFAULT_MODEL);
    expect(withOption.args.slice(0, 2)).toEqual(['--model', DEFAULT_MODEL]);
    expect(withOption.args).toContain('--connect-only');
    expect(withOption.args).not.toContain('--contribute');
  });
  it('still selects a reissued model by the name it replaced, and finds the weights stored under that name', () => {
    expect(nativeCommand(['serve', 'qwen-3-5-2b-q4k-ehaf16']).args[0]).toBe(TWO_B);
    expect(nativeCommand(['qwen-3-6-35b-a3b-text-source-q4_0-af32', '--connect-only']).args[0]).toBe('qwen-3-6-35b-a3b-text-source-q40-hq6k-af32');
    expect(() => nativeCommand(['serve', 'qwen-3-5-2b-q4k-ehaf17'])).toThrow(/Unknown model/);
    expect(nativeCommand(['serve', 'flash']).args[0]).toBe('qwen-3-8-flash-next-177b-text-source-q40-hq80-af32');
    expect(nativeCommand(['serve', 'flash-peer-effective-q8-v2']).args[0]).toBe('qwen-3-8-flash-next-177b-text-source-q40-hq80-af32');
    expect(nativeCommand(['serve', 'qwen3-8-27b-text-q4k-ehaf16']).args[0]).toBe(nativeCommand(['serve', '27b']).args[0]);
    const models = [{ id: 'new-name', supersedes: [{ id: 'old-name', identity: 'sha256:0' }] }, { id: 'plain' }];
    const directory = present => {
      const args = nodeArguments(['new-name'], { home: '/h', models, exists: file => present.includes(file) }).args;
      return args[args.indexOf('--model-directory') + 1];
    };
    expect(directory([])).toBe('/h/.reploid/weights/new-name');
    expect(directory(['/h/.reploid/weights/old-name'])).toBe('/h/.reploid/weights/old-name');
    // Its own directory wins once it exists.
    expect(directory(['/h/.reploid/weights/old-name', '/h/.reploid/weights/new-name'])).toBe('/h/.reploid/weights/new-name');
    expect(nodeArguments(['plain'], { home: '/h', models, exists: () => true }).args).toContain('/h/.reploid/weights/plain');
  });

  it('lists the 27B pinned download and retains the exact 27B model for solo and split', () => {
    const id = 'qwen-3-8-27b-text-q4k-ef16-af32';
    const row = nativeCommand(['models']).text.split('\n').find(line => line.startsWith('27b '));
    expect(row).toContain(id);
    expect(row).toContain('solo/split');
    expect(row).toContain('pinned download');
    for (const name of ['27b', id, 'qwen3-8-27b-text-q4k-ehaf16']) {
      expect(nativeCommand(['serve', name])).toEqual({ args: [id, '--contribute', '--execution-mode', 'whole-model'] });
      for (const stage of ['0', '1']) {
        expect(nativeCommand(['split', name, '--stage', stage]).args)
          .toEqual([id, '--contribute', '--execution-mode', 'partition', '--partition-index', stage]);
      }
    }
  });

  it('stands for an explicit whole-model contribute command with state under the home directory', () => {
    const node = nodeArguments(['qwen-3-5-0-8b-q4k-ef16-af32-vf16'], { home: '/home/someone' });
    expect(node.args).toEqual(['--model', 'qwen-3-5-0-8b-q4k-ef16-af32-vf16', '--contribute', '--execution-mode', 'whole-model',
      '--model-directory', '/home/someone/.reploid/weights/qwen-3-5-0-8b-q4k-ef16-af32-vf16', '--identity-file', '/home/someone/.reploid/identity.json',
      '--rtc-module', '@roamhq/wrtc', '--ws-module', 'ws', '--gpu-module', 'webgpu']);
    expect(node.chosen).toMatchObject({ mode: 'contribute', 'execution-mode': 'whole-model' });
  });

  it('keeps an explicit execution mode, and partition-only options keep partition execution', () => {
    for (const extra of [['--execution-mode', 'partition'], ['--execution-mode=partition']]) {
      const args = nodeArguments(['m', ...extra], { home: '/h' }).args;
      expect(args.filter(value => value.startsWith('--execution-mode'))).toHaveLength(1);
      expect(args).not.toContain('whole-model');
    }
    for (const option of [['--partition-index', '1'], ['--ordered-config', '/x/o.json'], ['--canonical'], ['--readiness-log', '/x/r.jsonl']]) {
      expect(nodeArguments(['m', ...option], { home: '/h' }).args).not.toContain('--execution-mode');
    }
    expect(nodeArguments(['m', '--contribute'], { home: '/h' }).args).toContain('whole-model');
    expect(nodeArguments(['m', '--connect-only'], { home: '/h' }).args).not.toContain('--execution-mode');
    expect(nodeArguments(['m', '--share-files'], { home: '/h' }).args).not.toContain('--execution-mode');
  });

  it('keeps what the operator chose and does not add compute to a mode that has none', () => {
    const node = nodeArguments(['m', '--connect-only', '--identity-file', '/x/id.json', '--room=lab'], { home: '/h' });
    expect(node.args).not.toContain('--contribute');
    expect(node.args).not.toContain('--gpu-module');
    expect(node.args.filter(value => value === '--identity-file')).toHaveLength(1);
    expect(node.args.slice(-4)).toEqual(['--connect-only', '--identity-file', '/x/id.json', '--room=lab']);
    expect(nodeArguments(['m', '--share-files'], { home: '/h' }).args).not.toContain('--gpu-module');
    expect(nodeArguments(['m', '--share-files', '--contribute'], { home: '/h' }).args).toContain('--gpu-module');
  });

  it('runs one participant: the entry path stays the command, so the participant module does not start itself too', () => {
    const command = '/pkg/reploid/server/native-node.js', participant = '/pkg/reploid/server/native-participant.js';
    const argv = participantProcessArgv(['/usr/bin/node', command, 'm'], ['--model', 'm', '--connect-only']);
    expect(argv).toEqual(['/usr/bin/node', command, '--model', 'm', '--connect-only']);
    expect(argv[1]).not.toBe(participant);
  });

  it('treats a leading option as the start of the options for the default model', () => {
    expect(nodeArguments(['--contribute'], { home: '/h' }).model).toBe(DEFAULT_MODEL);
  });

  it('is a command of the delivered package, which is private unless built to publish', () => {
    const application = { name: 'reploid', version: '0.1.0', license: 'MIT', repository: { url: 'r' }, homepage: 'h',
      dependencies: { 'dopplerx': '0.7.1', ws: '^8' }, optionalDependencies: { '@roamhq/wrtc': '0.10.0', webgpu: '0.4.0' } };
    expect(nativePackageManifest(application).bin.reploid).toBe('./server/native-node.js');
    expect(nativePackageManifest(application).private).toBe(true);
    expect('private' in nativePackageManifest(application, { publishable: true })).toBe(false);
  });

  it('names every packaged file that carries a home-directory path', () => {
    const contents = new Map([
      ['shared/config/model-manifests/abc.json', Buffer.from('{"metadata":{"source":"file:///home/someone/models/x"}}')],
      ['server/ok.js', Buffer.from('const ranges = ["100.64.0.0"]; const dir = "~/models";')],
      ['weights/shard_0.bin', Buffer.from('/Users/someone/ raw bytes are not text')],
    ]);
    expect(homePathFindings(contents)).toEqual([{ path: 'shared/config/model-manifests/abc.json', found: 'file:///home/someone/' }]);
  });
});

describe('native command vocabulary', () => {
  it('expands friendly commands and preserves legacy and private-room flags', () => {
    expect(nativeCommand(['serve', '2b']).args).toEqual([TWO_B, '--contribute', '--execution-mode', 'whole-model']);
    expect(nativeCommand(['split', '2b', '--stage=1', '--weights', '/weights', '--room', 'lab']).args)
      .toEqual([TWO_B, '--contribute', '--execution-mode', 'partition', '--partition-index=1', '--model-directory', '/weights', '--room', 'lab']);
    expect(nativeCommand(['--model', DEFAULT_MODEL, '--connect-only']).args).toEqual([DEFAULT_MODEL, '--connect-only']);
    expect(nativeCommand(['connect']).args).toEqual(['--connect-only']);
    expect(nativeCommand(['share', '2b']).args).toEqual([TWO_B, '--share-files']);
    expect(nativeCommand(['serve']).args).toEqual(['--contribute', '--execution-mode', 'whole-model']);
    expect(nodeArguments(nativeCommand(['serve']).args, { home: '/h' }).model).toBe(DEFAULT_MODEL);
    expect(nativeCommand(['custom', '--model-config', '/private/model.json']).args[0]).toBe('custom');
  });
  it('reports catalog limits before starting contribution', () => {
    expect(() => nativeCommand(['split', '35b', '--stage', '1'])).toThrow('whole-model serving only');
    expect(() => nativeCommand(['split', '2b'])).toThrow('--stage');
    expect(() => nativeCommand(['connect', '--contribute'])).toThrow('selects its mode');
    expect(() => nativeCommand(['serve', 'typo'])).toThrow('reploid models');
    const listing = nativeCommand(['models']).text;
    expect(listing).toContain('GB of files');
    expect(listing).toMatch(/qwen-3-8-flash-next-177b-text-source-q40-hq80-af32\s+107\.0\s+solo\s/);
    expect(nativeCommand(['help', 'split']).text).toContain('--room-token-file');
    expect(nativeCommand(['help', 'options']).text).toContain('--owner-policy');
  });
});
