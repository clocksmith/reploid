/**
 * @fileoverview Source-to-/self mirror rules for self-hosted lab profiles.
 */

export const ZERO_RUNTIME_SELF_MIRROR_RULES = Object.freeze([
  { sourcePath: '/config/lab-route-profiles.js', targetPath: '/self/config/lab-route-profiles.js' },
  { sourcePath: '/config/tool-surfaces.js', targetPath: '/self/config/tool-surfaces.js' },
  { sourcePrefix: '/lab/', targetPrefix: '/self/lab/' },
  { sourcePath: '/ui/zero/index.js', targetPath: '/self/ui/zero/index.js' },
  { sourcePath: '/styles/zero.css', targetPath: '/self/styles/zero.css' }
]);

export const PROTO_RUNTIME_SELF_MIRROR_RULES = Object.freeze([
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
