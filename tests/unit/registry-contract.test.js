// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildInventory } from '../../scripts/build-module-inventory.js';
import { buildBlueprintRegistry, renderBlueprintInventory } from '../../scripts/build-blueprint-registry.js';
import { buildModuleRegistry } from '../../scripts/build-module-registry.js';
import { auditRegistry, registryExitCode } from '../../scripts/validate-registry.js';

const fixtures = [];
const json = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const blueprint = (id, owned) => `# Blueprint ${id}: Fixture

**Classification:** Canonical Full Specification
**Implementation Status:** Implemented
**Owned Source Files:** ${owned}
**Verified Artifacts:** None
**Planned Artifacts:** None
`;
const source = (dependencies = '[]') => `export default {
  metadata: { id: 'Fixture', dependencies: ${dependencies}, genesis: { introduced: 'minimal' } }
};\n`;

async function fixture() {
  const selfDir = await mkdtemp(path.join(tmpdir(), 'reploid-registry-test-'));
  fixtures.push(selfDir);
  await Promise.all(['config', 'blueprints', 'pool'].map((dir) => mkdir(path.join(selfDir, dir))));
  await writeFile(path.join(selfDir, 'pool/helper.js'), 'export const helper = true;\n');
  await writeFile(path.join(selfDir, 'pool/entry.js'), source());
  await writeFile(path.join(selfDir, 'blueprints/0x000000-fixture.md'), blueprint('0x000000', 'None'));
  const genesis = { levels: { minimal: { modules: ['Fixture'] } }, moduleFiles: { Fixture: ['pool/entry.js'] } };
  await json(path.join(selfDir, 'config/genesis-levels.json'), genesis);
  await regenerate(selfDir);
  return selfDir;
}

async function regenerate(selfDir) {
  const inventory = await buildInventory({ selfDir });
  const { registry, declarations } = await buildBlueprintRegistry({ selfDir, inventory });
  await json(path.join(selfDir, 'config/module-inventory.json'), inventory);
  await json(path.join(selfDir, 'config/blueprint-registry.json'), registry);
  await writeFile(path.join(selfDir, 'blueprints/canonical-inventory.md'), renderBlueprintInventory(declarations));
  await json(path.join(selfDir, 'config/module-registry.json'), await buildModuleRegistry({ selfDir }));
  await json(path.join(selfDir, 'config/vfs-manifest.json'), { version: 1, files: inventory.modules.map((entry) => entry.path) });
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('source-owned registry contracts', () => {
  it('inventories helpers without inventing architectural ownership, without writing during audit', async () => {
    const selfDir = await fixture();
    const before = await readFile(path.join(selfDir, 'config/module-inventory.json'), 'utf8');
    const report = await auditRegistry({ selfDir });
    expect(report.issues).toEqual([]);
    expect(report.classifications).toEqual({ inventoriedHelpers: ['pool/helper.js'], modulesWithoutArchitecturalBlueprint: ['Fixture'] });
    expect(registryExitCode(report)).toBe(0);
    expect(await readFile(path.join(selfDir, 'config/module-inventory.json'), 'utf8')).toBe(before);
  });

  it('takes ownership only from maintained declarations, never old output or affected-artifact mentions', async () => {
    const selfDir = await fixture();
    const declared = blueprint('0x000000', '`pool/helper.js`') + '\n**Affected Artifacts:** pool/entry.js\n';
    await writeFile(path.join(selfDir, 'blueprints/0x000000-fixture.md'), declared);
    await json(path.join(selfDir, 'config/blueprint-registry.json'), { version: 1, features: [{ id: '0xFFFFFF', files: ['pool/helper.js'] }] });
    const { registry } = await buildBlueprintRegistry({ selfDir });
    expect(registry.features).toHaveLength(1);
    expect(registry.features[0]).toMatchObject({ id: '0x000000', files: ['pool/helper.js'] });
    expect((await auditRegistry({ selfDir })).issues.map((issue) => issue.type)).toContain('stale_blueprint_registry');
    await regenerate(selfDir);
    expect((await auditRegistry({ selfDir })).issues).toEqual([]);
  });

  it('rejects duplicate owners and declarations for missing sources', async () => {
    const selfDir = await fixture();
    await writeFile(path.join(selfDir, 'blueprints/0x000000-fixture.md'), blueprint('0x000000', '`pool/helper.js`'));
    await writeFile(path.join(selfDir, 'blueprints/0x000001-second.md'), blueprint('0x000001', '`pool/helper.js`'));
    await expect(buildBlueprintRegistry({ selfDir })).rejects.toThrow('Duplicate owner');
    await writeFile(path.join(selfDir, 'blueprints/0x000001-second.md'), blueprint('0x000001', '`pool/missing.js`'));
    await expect(buildBlueprintRegistry({ selfDir })).rejects.toThrow('owned source does not exist');
  });

  it('does not hide stale or missing helpers in the inventory classification', async () => {
    const selfDir = await fixture();
    await writeFile(path.join(selfDir, 'pool/helper.js'), 'export const changed = true;\n');
    expect((await auditRegistry({ selfDir })).issues).toContainEqual({ type: 'stale_inventory_entry', severity: 'medium', file: 'pool/helper.js' });
    await rm(path.join(selfDir, 'pool/helper.js'));
    const report = await auditRegistry({ selfDir });
    expect(report.issues.map((issue) => issue.type)).toContain('missing_source_file');
    expect(registryExitCode(report)).toBe(1);
  });

  it('rejects incomplete inventory and VFS coverage, including their duplicate entries', async () => {
    const selfDir = await fixture();
    const inventory = await buildInventory({ selfDir });
    inventory.modules = [inventory.modules[0], inventory.modules[0]];
    await json(path.join(selfDir, 'config/module-inventory.json'), inventory);
    await json(path.join(selfDir, 'config/vfs-manifest.json'), { version: 1, files: ['pool/entry.js', 'pool/entry.js'] });
    expect((await auditRegistry({ selfDir })).issues.map((issue) => issue.type)).toEqual(expect.arrayContaining([
      'duplicate_inventory_file', 'uninventoried_source_file', 'duplicate_vfs_file', 'source_missing_from_vfs'
    ]));
  });

  it('does not fall back to generated metadata when source metadata is broken', async () => {
    const selfDir = await fixture();
    await writeFile(path.join(selfDir, 'pool/entry.js'), 'export default {};\n');
    await expect(buildModuleRegistry({ selfDir })).rejects.toThrow('Source metadata disagrees');
    expect((await auditRegistry({ selfDir })).issues.map((issue) => issue.type)).toContain('invalid_module_source');
  });

  it('rejects unsupported inventory versions even when every file matches', async () => {
    const selfDir = await fixture();
    await json(path.join(selfDir, 'config/module-inventory.json'), { ...await buildInventory({ selfDir }), version: 999 });
    expect((await auditRegistry({ selfDir })).issues).toContainEqual({
      type: 'unsupported_registry_version', severity: 'medium', registry: 'inventory', version: 999
    });
  });

  it('fails required missing dependencies, cycles, and every unresolved severity', async () => {
    const selfDir = await fixture();
    await writeFile(path.join(selfDir, 'pool/entry.js'), source("['Missing']"));
    await regenerate(selfDir);
    expect((await auditRegistry({ selfDir })).issues.map((issue) => issue.type)).toContain('missing_dep');
    await writeFile(path.join(selfDir, 'pool/entry.js'), source("['Fixture']"));
    await regenerate(selfDir);
    expect((await auditRegistry({ selfDir })).issues.map((issue) => issue.type)).toContain('circular_dep');
    for (const severity of ['low', 'medium', 'high']) expect(registryExitCode({ issues: [{ severity }] })).toBe(1);
  });
});
