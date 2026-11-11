import { describe, expect, it } from 'vitest';
import { nodeArguments } from '../../server/native-node.js';
import { homePathFindings, nativePackageManifest } from '../../scripts/package-native.js';

describe('reploid <model>: the short native command', () => {
  it('stands for an explicit contribute command with state under the home directory', () => {
    const node = nodeArguments(['qwen-3-5-0-8b-q4k-ehaf16'], { home: '/home/someone' });
    expect(node.args).toEqual(['--model', 'qwen-3-5-0-8b-q4k-ehaf16', '--contribute',
      '--model-directory', '/home/someone/.reploid/weights', '--identity-file', '/home/someone/.reploid/identity.json',
      '--rtc-module', '@roamhq/wrtc', '--ws-module', 'ws', '--gpu-module', 'webgpu']);
    expect(node.chosen.mode).toBe('contribute');
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

  it('needs a model first', () => {
    expect(nodeArguments([], { home: '/h' })).toBeNull();
    expect(nodeArguments(['--contribute'], { home: '/h' })).toBeNull();
  });

  it('is a command of the delivered package, which is private unless built to publish', () => {
    const application = { name: 'reploid', version: '0.1.0', license: 'MIT', repository: { url: 'r' }, homepage: 'h',
      dependencies: { 'doppler-gpu': '0.7.1', ws: '^8' }, optionalDependencies: { '@roamhq/wrtc': '0.10.0', webgpu: '0.4.0' } };
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
