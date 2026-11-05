// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findBoundaryViolations } from '../../scripts/verify-browser-boundaries.js';
import { openBrowserTree, toServedModuleSource } from '../../server/browser-tree.js';

const fixtures = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function repository(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'reploid-boundaries-'));
  fixtures.push(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}
const reasons = violations => violations.map(item => `${item.source} ${item.reason}`);

describe('browser ownership boundaries', () => {
  it('lets the product load shared code and the documented substrate entry points', async () => {
    const repoRoot = await repository({
      'shared/core/utils.js': 'export const id = 1;',
      'self/zero/boot.js': "import { id } from '../../shared/core/utils.js'; export const bootZero = () => id;",
      'apps/poolday/ui/pool-home/index.js': "import { id } from '../../../../shared/core/utils.js'; export default id;",
      'apps/poolday/index.html': "<script type=\"module\">import('/zero/boot.js'); import('/ui/pool-home/index.js');</script>"
    });
    expect(await findBoundaryViolations({ repoRoot })).toEqual([]);
  });

  it('rejects substrate, shared and undocumented product crossings', async () => {
    const repoRoot = await repository({
      'apps/poolday/pool/config.js': 'export default {};',
      'self/core/agent.js': "import '../../apps/poolday/pool/config.js';",
      'self/core/loader.js': "export const load = () => import('/pool/config.js');",
      'shared/identity.js': "import '../self/core/agent.js';",
      'apps/poolday/ui/view.js': "import '../../../self/core/agent.js'; import '../../../packages/reploid/src/index.js';",
      'apps/poolday/page.html': '<link rel="stylesheet" href="/styles/missing.css">'
    });
    expect(reasons(await findBoundaryViolations({ repoRoot })).sort()).toEqual([
      'apps/poolday/page.html served reference names no file in the browser tree',
      'apps/poolday/ui/view.js apps/poolday may not load self outside its documented entry points',
      'apps/poolday/ui/view.js relative reference leaves the browser tree or names no source file',
      'self/core/agent.js self may not load apps/poolday',
      'self/core/loader.js self may not load apps/poolday',
      'shared/identity.js shared may not load self'
    ]);
  });

  it('serves cross-root specifiers relative to the served namespace and leaves the rest unchanged', async () => {
    const code = "import a from '../../../../shared/ui/components/x.js';\nimport b from './y.js';\n"
      + "const c = () => import('../../../../shared/config/z.json?v=1');\nnew URL('../../../../shared/vendor/w.js', import.meta.url);";
    expect(toServedModuleSource(code, 'apps/poolday/ui/pool-home/i.js')).toBe("import a from '../components/x.js';\nimport b from './y.js';\n"
      + "const c = () => import('../../config/z.json?v=1');\nnew URL('../../vendor/w.js', import.meta.url);");
    expect(toServedModuleSource("import x from './x.js';", 'self/core/a.js')).toBe("import x from './x.js';");
    const repoRoot = await repository({ 'self/a.js': '1', 'shared/a.js': '2' });
    await expect(openBrowserTree({ repoRoot })).rejects.toThrow('Served path a.js has two sources');
  });
});
