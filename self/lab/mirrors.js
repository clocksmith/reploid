/**
 * @fileoverview Source-to-/self mirror rules for self-hosted lab profiles.
 */

export const ZERO_RUNTIME_SELF_MIRROR_RULES = Object.freeze([
  { sourcePath: '/config/lab-route-profiles.js', targetPath: '/self/config/lab-route-profiles.js' },
  { sourcePath: '/config/tool-surfaces.js', targetPath: '/self/config/tool-surfaces.js' },
  { sourcePath: '/core/run-replay-bundle.js', targetPath: '/self/core/run-replay-bundle.js' },
  { sourcePrefix: '/lab/', targetPrefix: '/self/lab/' },
  { sourcePrefix: '/ui/zero/', targetPrefix: '/self/ui/zero/' },
  { sourcePath: '/styles/zero.css', targetPath: '/self/styles/zero.css' }
]);

export const PROTO_RUNTIME_SELF_MIRROR_RULES = Object.freeze([
  { sourcePath: '/ui/toast.js', targetPath: '/self/ui/toast.js' },
  { sourcePrefix: '/ui/components/', targetPrefix: '/self/ui/components/' },
  { sourcePrefix: '/ui/panels/', targetPrefix: '/self/ui/panels/' },
  { sourcePrefix: '/ui/proto/', targetPrefix: '/self/ui/proto/' },
  { sourcePrefix: '/styles/proto/', targetPrefix: '/self/styles/proto/' }
]);

export const normalizeVfsPath = (path) => {
  const value = String(path || '').trim();
  if (!value) return '';
  return value.startsWith('/') ? value : `/${value}`;
};

const getManifestPath = (file) => normalizeVfsPath(
  typeof file === 'string'
    ? file
    : (file?.path || file?.sourcePath || file?.source || '')
);

export const buildRuntimeSelfMirrors = (rules = [], files = []) => {
  const manifestPaths = files.map(getManifestPath).filter(Boolean);
  const mirrors = new Map();

  const addMirror = (sourcePath, targetPath) => {
    const source = normalizeVfsPath(sourcePath);
    const target = normalizeVfsPath(targetPath);
    if (!source || !target) return;
    mirrors.set(`${source}->${target}`, { sourcePath: source, targetPath: target });
  };

  rules.forEach((rule) => {
    if (rule.sourcePath && rule.targetPath) {
      addMirror(rule.sourcePath, rule.targetPath);
      return;
    }

    const sourcePrefix = normalizeVfsPath(rule.sourcePrefix);
    const targetPrefix = normalizeVfsPath(rule.targetPrefix);
    if (!sourcePrefix || !targetPrefix) return;

    manifestPaths.forEach((path) => {
      if (!path.startsWith(sourcePrefix)) return;
      addMirror(path, `${targetPrefix}${path.slice(sourcePrefix.length)}`);
    });
  });

  return [...mirrors.values()];
};
