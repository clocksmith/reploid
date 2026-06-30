/**
 * @fileoverview Shared import rewriting for VFS blob modules and service worker responses.
 *
 * This file intentionally has no ESM exports so it can be loaded both as an
 * ESM side-effect import and through service-worker importScripts().
 */

(function installImportRewrite(root) {
  const DEFAULT_REWRITEABLE_IMPORT_ROOTS = Object.freeze([
    '/self/',
    '/tools/',
    '/core/',
    '/infrastructure/',
    '/capabilities/',
    '/ui/',
    '/styles/',
    '/config/',
    '/capsule/',
    '/shadow/',
    '/artifacts/'
  ]);

  const isRewriteableSpecifier = (specifier, roots = DEFAULT_REWRITEABLE_IMPORT_ROOTS) => {
    if (!specifier || typeof specifier !== 'string') return false;
    if (specifier.startsWith('#')) return false;
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier)) return false;
    if (specifier.startsWith('.')) return true;
    return roots.some((rootPath) => specifier.startsWith(rootPath));
  };

  const toBaseUrl = (base, origin) => {
    if (base instanceof URL) return base;
    return new URL(String(base || '/'), origin || 'http://reploid.local');
  };

  const defaultRewriteSpecifier = (specifier, options = {}) => {
    const roots = options.roots || DEFAULT_REWRITEABLE_IMPORT_ROOTS;
    if (!isRewriteableSpecifier(specifier, roots)) return specifier;

    const baseUrl = toBaseUrl(options.baseUrl || options.basePath || '/', options.origin);
    const url = new URL(specifier, baseUrl);
    if (options.origin && url.origin !== options.origin) return specifier;

    const version = options.version || null;
    const versionParam = options.versionParam || 'v';
    if (version) {
      url.searchParams.set(versionParam, version);
    }

    const instanceId = options.instanceId || null;
    const instanceParam = options.instanceParam || 'instance';
    if (instanceId && !url.searchParams.has(instanceParam)) {
      url.searchParams.set(instanceParam, instanceId);
    }

    if (options.absolute === true) {
      return url.href;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  };

  const rewriteModuleImports = (content, options = {}) => {
    const rewriteSpecifier = typeof options.rewriteSpecifier === 'function'
      ? options.rewriteSpecifier
      : (specifier) => defaultRewriteSpecifier(specifier, options);

    return String(content || '')
      .replace(/\b((?:import|export)\s+[^'";]*?\s+from\s*)(['"])([^'"]+)\2/g, (match, prefix, quote, specifier) => (
        `${prefix}${quote}${rewriteSpecifier(specifier)}${quote}`
      ))
      .replace(/\b(import\s*)(['"])([^'"]+)\2/g, (match, prefix, quote, specifier) => (
        `${prefix}${quote}${rewriteSpecifier(specifier)}${quote}`
      ))
      .replace(/\b(import\s*\(\s*)(['"])([^'"]+)\2/g, (match, prefix, quote, specifier) => (
        `${prefix}${quote}${rewriteSpecifier(specifier)}${quote}`
      ));
  };

  root.REPLOID_IMPORT_REWRITE = Object.freeze({
    DEFAULT_REWRITEABLE_IMPORT_ROOTS,
    isRewriteableSpecifier,
    rewriteSpecifier: defaultRewriteSpecifier,
    rewriteModuleImports
  });
})(globalThis);
