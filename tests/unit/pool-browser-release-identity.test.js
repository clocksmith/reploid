import { describe, expect, it } from 'vitest';

import {
  BROWSER_BUNDLE_MANIFEST_SCHEMA,
  SOURCE_RELEASE_IDENTITY_SCHEMA,
  buildBrowserBundleManifest,
  buildSourceReleaseIdentity,
  validateBrowserBundleManifest,
  validateSourceReleaseIdentity
} from '../../self/pool/browser-release-identity.js';

const entries = () => [
  { path: 'pool/runtime.js', bytes: new TextEncoder().encode('runtime') },
  { path: 'index.html', bytes: new TextEncoder().encode('<main>Reploid</main>') }
];

describe('Poolday browser release identity', () => {
  it('builds one deterministic byte-bound manifest regardless of input order', async () => {
    const forward = await buildBrowserBundleManifest(entries());
    const reversed = await buildBrowserBundleManifest(entries().reverse());

    expect(forward).toEqual(reversed);
    expect(forward.schema).toBe(BROWSER_BUNDLE_MANIFEST_SCHEMA);
    expect(forward.files.map((file) => file.path)).toEqual(['index.html', 'pool/runtime.js']);
    expect(await validateBrowserBundleManifest(forward, { entries: entries() })).toMatchObject({
      ok: true,
      reasons: []
    });
  });

  it('changes both the file and bundle identities when one served byte changes', async () => {
    const baseline = await buildBrowserBundleManifest(entries());
    const mutatedEntries = entries();
    mutatedEntries[0].bytes = new TextEncoder().encode('runtimf');
    const candidate = await buildBrowserBundleManifest(mutatedEntries);

    expect(candidate.files.find((file) => file.path === 'pool/runtime.js')?.byteLength)
      .toBe(baseline.files.find((file) => file.path === 'pool/runtime.js')?.byteLength);
    expect(candidate.files.find((file) => file.path === 'pool/runtime.js')?.sha256)
      .not.toBe(baseline.files.find((file) => file.path === 'pool/runtime.js')?.sha256);
    expect(candidate.bundleHash).not.toBe(baseline.bundleHash);
  });

  it('rejects stale bytes, missing files, duplicates, and noncanonical ordering', async () => {
    const manifest = await buildBrowserBundleManifest(entries());
    const stale = await validateBrowserBundleManifest(manifest, {
      entries: [{ path: 'index.html', bytes: '<main>changed</main>' }]
    });
    expect(stale).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['browser bundle manifest does not match the supplied bytes'])
    });

    const malformed = structuredClone(manifest);
    malformed.files = [malformed.files[1], malformed.files[1]];
    const malformedValidation = await validateBrowserBundleManifest(malformed);
    expect(malformedValidation).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'browser bundle manifest path is duplicated: pool/runtime.js',
        'browser bundle manifest paths are not strictly sorted: pool/runtime.js',
        'browser bundle manifest bundle hash is invalid'
      ])
    });
  });

  it('builds a clean source identity and refuses to bless a dirty source tree', async () => {
    const identity = await buildSourceReleaseIdentity({
      sourceRevision: '7aa2255ca63c',
      sourceTreeBytes: '100644 blob abc\tGOALS.md\n',
      sourceDirty: false,
      trackedFileCount: 1
    });
    expect(identity).toMatchObject({
      schema: SOURCE_RELEASE_IDENTITY_SCHEMA,
      sourceRevision: '7aa2255ca63c',
      sourceDirty: false,
      trackedFileCount: 1
    });
    expect(validateSourceReleaseIdentity(identity)).toEqual({ ok: true, reasons: [] });

    await expect(buildSourceReleaseIdentity({
      sourceRevision: '7aa2255ca63c',
      sourceTreeBytes: '',
      sourceDirty: true
    })).rejects.toThrow('source release identity requires a clean tree');
    expect(validateSourceReleaseIdentity({ ...identity, sourceDirty: true })).toMatchObject({
      ok: false,
      reasons: ['source release tree is dirty']
    });
  });
});
