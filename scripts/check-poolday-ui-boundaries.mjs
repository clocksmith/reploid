#!/usr/bin/env node
// Deterministic design-system and architecture checks for the React Poolday tree, driven by
// scripts/poolday-ui-architecture.json.
//
// Adapted from clocksmith/react-starter tool/check_boundaries.mjs (commit cd07713): the same
// syntactic import, layer, feature, markup and platform rules, with Reploid's layout and three
// additions: style literals, ui style parameters, and the framework-free API bridge.
//
// It parses every source file and checks each import, re-export, dynamic import, require and
// import type. These are syntactic checks, not a security sandbox; review owns business meaning
// and behaviour tests own observable correctness. Do not add exemptions to accommodate misplaced
// code: change the policy, AGENTS.md and the architecture section of docs/style-guide.md together.
import { parse } from '@babel/parser';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const posix = (path) => path.split(sep).join('/');

function listFiles(root, sourceRoot, extensions, violations, { reportMissing = true } = {}) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = posix(relative(root, full));
      const info = lstatSync(full);
      if (info.isSymbolicLink()) {
        violations.push({ file: rel, rule: 'symlink', message: 'Source symlinks are rejected, not followed.' });
      } else if (info.isDirectory()) {
        walk(full);
      } else if (extensions.some((extension) => name.endsWith(extension)) && !name.endsWith('.d.ts')) {
        files.push(rel);
      }
    }
  };
  const start = join(root, sourceRoot);
  if (existsSync(start)) walk(start);
  else if (reportMissing) violations.push({ file: sourceRoot, rule: 'missing-root', message: 'Declared source root does not exist.' });
  return files;
}

function layerOf(file, policy) {
  const matches = Object.entries(policy.layers)
    .filter(([, layer]) => layer.paths.some((pattern) => new RegExp(pattern).test(file)))
    .map(([name]) => name);
  if (matches.length === 0) return null;
  return matches.length === 1 ? matches[0] : matches;
}

/** Walks a Babel AST with parent links, without a traversal library. */
function walkAst(node, visit, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent, key);
  for (const [childKey, value] of Object.entries(node)) {
    if (childKey === 'loc' || childKey === 'start' || childKey === 'end' || childKey === 'range') continue;
    if (Array.isArray(value)) for (const child of value) walkAst(child, visit, node, childKey);
    else if (value && typeof value === 'object') walkAst(value, visit, node, childKey);
  }
}

const literal = (node) => {
  if (node?.type === 'StringLiteral') return node.value;
  return node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : null;
};

/** The name a react import specifier brings in: a named export, `default` or the namespace. */
const importedName = (specifier) => {
  if (specifier.type === 'ImportSpecifier') return specifier.imported.name ?? specifier.imported.value;
  return specifier.type === 'ImportDefaultSpecifier' ? 'default' : '*';
};

const unwrap = (node) => {
  let current = node;
  while (current && ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(current.type)) {
    current = current.expression;
  }
  return current;
};

/** Everything the policy cares about in one file. */
export function inspectSource(code, file) {
  const ast = parse(code, {
    sourceType: 'module',
    sourceFilename: file,
    plugins: file.endsWith('.js') || file.endsWith('.mjs') ? ['jsx'] : ['typescript', 'jsx'],
    errorRecovery: false,
  });
  const specifiers = [];
  const unresolvable = [];
  const reactImports = [];
  const intrinsicElements = [];
  const markupAttributes = [];
  const identifiers = [];
  const members = [];
  const strings = [];
  const styleValues = [];
  const objects = new Map();
  const declared = new Set();
  let jsx = false;

  const declare = (pattern) =>
    walkAst(pattern, (node, parent, key) => {
      if (node.type === 'Identifier' && !(parent?.type === 'ObjectProperty' && key === 'key' && !parent.computed)) {
        declared.add(node.name);
      }
    });

  walkAst(ast.program, (node, parent, key) => {
    switch (node.type) {
      case 'ImportDeclaration': {
        specifiers.push(node.source.value);
        for (const specifier of node.specifiers) declared.add(specifier.local.name);
        if (node.source.value === 'react') {
          for (const specifier of node.specifiers) reactImports.push(importedName(specifier));
        }
        break;
      }
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration':
        if (node.source) specifiers.push(node.source.value);
        break;
      case 'TSImportType': {
        const value = literal(node.source) ?? literal(node.argument) ?? literal(node.argument?.literal);
        if (value === null) unresolvable.push('import type');
        else specifiers.push(value);
        break;
      }
      case 'TSImportEqualsDeclaration':
        if (node.moduleReference?.type === 'TSExternalModuleReference') specifiers.push(node.moduleReference.expression.value);
        break;
      case 'ImportExpression': {
        const value = literal(node.source);
        if (value === null) unresolvable.push('dynamic import');
        else specifiers.push(value);
        break;
      }
      case 'CallExpression': {
        const isImport = node.callee.type === 'Import';
        const isRequire = node.callee.type === 'Identifier' && node.callee.name === 'require';
        if (isImport || isRequire) {
          const value = literal(node.arguments[0]);
          if (value === null) unresolvable.push(isImport ? 'dynamic import' : 'require');
          else specifiers.push(value);
        }
        break;
      }
      case 'JSXElement':
      case 'JSXFragment':
        jsx = true;
        break;
      case 'JSXOpeningElement':
        if (node.name.type === 'JSXIdentifier' && /^[a-z]/.test(node.name.name)) intrinsicElements.push(node.name.name);
        break;
      case 'JSXAttribute':
        if (node.name.type === 'JSXIdentifier') {
          markupAttributes.push(node.name.name);
          if (node.name.name === 'style') styleValues.push(node.value?.type === 'JSXExpressionContainer' ? unwrap(node.value.expression) : node.value);
        }
        break;
      case 'StringLiteral':
        if (parent?.type !== 'ImportDeclaration' && parent?.type !== 'ExportNamedDeclaration' && parent?.type !== 'ExportAllDeclaration') {
          strings.push(node.value);
        }
        break;
      case 'TemplateElement':
        strings.push(node.value.cooked ?? '');
        break;
      case 'JSXText':
        strings.push(node.value);
        break;
      case 'MemberExpression':
      case 'OptionalMemberExpression':
        if (!node.computed && node.property.type === 'Identifier') members.push(node.property.name);
        break;
      case 'VariableDeclarator':
        declare(node.id);
        if (node.id.type === 'Identifier') objects.set(node.id.name, unwrap(node.init));
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ClassMethod':
      case 'ObjectMethod':
        if (node.id) declared.add(node.id.name);
        for (const param of node.params) declare(param);
        break;
      case 'TSFunctionType':
      case 'TSConstructorType':
      case 'TSMethodSignature':
      case 'TSCallSignatureDeclaration':
      case 'TSDeclareFunction':
        // Parameter names in a type are bindings, not references to globals.
        for (const param of node.parameters ?? node.params ?? []) declare(param);
        break;
      case 'ClassDeclaration':
        if (node.id) declared.add(node.id.name);
        break;
      case 'CatchClause':
        if (node.param) declare(node.param);
        break;
      case 'Identifier': {
        const isMemberProperty =
          (parent?.type === 'MemberExpression' || parent?.type === 'OptionalMemberExpression') && key === 'property' && !parent.computed;
        const isKey =
          key === 'key' &&
          !parent?.computed &&
          ['ObjectProperty', 'ObjectMethod', 'ClassProperty', 'ClassMethod', 'TSPropertySignature', 'TSMethodSignature'].includes(parent?.type);
        const isTypeName = ['TSQualifiedName', 'TSTypeReference', 'TSExpressionWithTypeArguments'].includes(parent?.type);
        const isLabel = ['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent?.type);
        const isImportName = parent?.type?.startsWith('Import') || parent?.type?.startsWith('Export');
        if (!isMemberProperty && !isKey && !isTypeName && !isLabel && !isImportName) identifiers.push(node.name);
        break;
      }
    }
  });
  // A style value must be an object literal (directly or through one local constant) whose keys
  // are all component parameters, so the component's stylesheet decides how each one renders.
  const styleKeys = styleValues.map((value) => {
    const object = value?.type === 'Identifier' ? objects.get(value.name) : value;
    if (object?.type !== 'ObjectExpression') return null;
    return object.properties.map((property) =>
      property.type === 'ObjectProperty' && !property.computed ? (property.key.value ?? property.key.name ?? null) : null,
    );
  });
  return { specifiers, unresolvable, reactImports, intrinsicElements, markupAttributes, identifiers, members, strings, styleKeys, declared, jsx };
}

function resolveRelative(root, fromFile, specifier, extensions) {
  const base = posix(relative(root, resolve(root, dirname(fromFile), specifier)));
  const withoutJs = base.replace(/\.jsx?$/, '');
  const candidates = [base, ...extensions.map((e) => withoutJs + e), ...extensions.map((e) => `${base}/index${e}`)];
  for (const candidate of candidates) {
    const full = join(root, candidate);
    if (existsSync(full) && statSync(full).isFile()) return candidate;
  }
  return null;
}

const packageRootOf = (file, policy) =>
  Object.values(policy.workspacePackages).find((spec) => file === spec.root || file.startsWith(`${spec.root}/`))?.root ?? 'apps/poolday-react';

const featureOf = (file) => /\/features\/([^/]+)\//.exec(file)?.[1] ?? null;

function checkManifests(root, policy, report) {
  for (const [name, spec] of Object.entries(policy.workspacePackages)) {
    const path = `${spec.root}/package.json`;
    if (!existsSync(join(root, path))) {
      report(path, 'manifest', `Missing manifest for ${name}.`);
      continue;
    }
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8'));
    const same = (actual, expected) => JSON.stringify(Object.keys(actual ?? {}).sort()) === JSON.stringify([...expected].sort());
    if (manifest.name !== name) report(path, 'manifest', `Expected package name ${name}.`);
    if (!same(manifest.dependencies, spec.dependencies)) report(path, 'manifest', `Runtime dependencies must be exactly ${JSON.stringify(spec.dependencies)}.`);
    if (!same(manifest.peerDependencies, spec.peerDependencies)) report(path, 'manifest', `Peer dependencies must be exactly ${JSON.stringify(spec.peerDependencies)}.`);
    if (!same(manifest.exports, spec.entries)) report(path, 'manifest', `Public entries must be exactly ${JSON.stringify(spec.entries)}; internal files stay unreachable.`);
  }
}

function findCycle(graph) {
  const state = new Map();
  const stack = [];
  const visit = (file) => {
    state.set(file, 'open');
    stack.push(file);
    for (const next of graph.get(file) ?? []) {
      if (state.get(next) === 'open') return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(file, 'done');
    return null;
  };
  for (const file of [...graph.keys()].sort()) {
    if (!state.has(file)) {
      const cycle = visit(file);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** Public entry files of the API bridge, from its package manifest. */
function bridgeEntries(root, bridge) {
  const manifestPath = join(root, bridge.manifest);
  if (!existsSync(manifestPath)) return { entries: new Set(), types: [] };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entries = new Set();
  const types = [];
  const base = dirname(bridge.manifest);
  for (const [entry, target] of Object.entries(manifest.exports ?? {})) {
    const value = typeof target === 'string' ? { import: target } : target;
    const file = value.import ?? value.default;
    if (file) entries.add(posix(join(base, file)));
    // JSON entries are data with their own schema; module entries carry declarations.
    if (!String(file ?? entry).endsWith('.json')) types.push({ entry, file: value.types ? posix(join(base, value.types)) : null });
  }
  return { entries, types };
}

/**
 * The API bridge (packages/reploid/src) stays framework-free: typed requests and responses, no
 * React, no rendering and no presentation state.
 */
function checkBridge(root, policy, report) {
  const bridge = policy.bridge;
  if (!bridge) return;
  const { types } = bridgeEntries(root, bridge);
  for (const { entry, file } of types) {
    if (!file) report(bridge.manifest, 'bridge-types', `Public entry "${entry}" declares no types; requests and responses must be typed.`);
    else if (!existsSync(join(root, file))) report(bridge.manifest, 'bridge-types', `Public entry "${entry}" declares missing types ${file}.`);
  }
  const files = listFiles(root, bridge.root, ['.js', '.mjs', '.ts'], [], { reportMissing: false });
  for (const file of files) {
    let facts;
    try {
      facts = inspectSource(readFileSync(join(root, file), 'utf8'), file);
    } catch (error) {
      report(file, 'parse', `Could not parse: ${error.message}`);
      continue;
    }
    for (const specifier of facts.specifiers) {
      if (bridge.forbiddenPackages.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
        report(file, 'bridge', `The API bridge may not import "${specifier}"; it stays framework-free.`);
      }
    }
    if (facts.jsx) report(file, 'bridge', 'The API bridge may not contain JSX; rendering belongs to the app.');
    for (const member of new Set(facts.members)) {
      if (bridge.forbiddenMembers.includes(member)) report(file, 'bridge', `The API bridge may not write markup ("${member}").`);
    }
    for (const name of new Set(facts.identifiers)) {
      if (bridge.forbiddenGlobals.includes(name) && !facts.declared.has(name)) report(file, 'bridge', `The API bridge may not use the DOM global "${name}".`);
    }
  }
}

/** Returns every violation of `policy` under `root`. An empty list means the tree conforms. */
export function checkArchitecture({ root, policy }) {
  const violations = [];
  const report = (file, rule, message) => violations.push({ file, rule, message });
  const files = policy.sourceRoots.flatMap((sourceRoot) => listFiles(root, sourceRoot, policy.extensions, violations));
  const fileSet = new Set(files);
  const graph = new Map();
  const literalPattern = new RegExp(policy.literalPattern);
  const bridge = policy.bridge ? bridgeEntries(root, policy.bridge) : { entries: new Set() };

  checkManifests(root, policy, report);
  checkBridge(root, policy, report);

  for (const file of files) {
    const layerName = layerOf(file, policy);
    if (layerName === null) {
      report(file, 'unclassified', 'File is under a checked root but belongs to no layer.');
      continue;
    }
    if (Array.isArray(layerName)) {
      report(file, 'unclassified', `File matches more than one layer: ${layerName.join(', ')}.`);
      continue;
    }
    const layer = policy.layers[layerName];
    let facts;
    try {
      facts = inspectSource(readFileSync(join(root, file), 'utf8'), file);
    } catch (error) {
      report(file, 'parse', `Could not parse: ${error.message}`);
      continue;
    }
    const edges = new Set();
    graph.set(file, edges);

    for (const kind of facts.unresolvable) report(file, 'unresolvable-import', `A ${kind} with a computed path cannot be checked.`);

    for (const specifier of facts.specifiers) {
      if (specifier.startsWith('.')) {
        const target = resolveRelative(root, file, specifier, [...policy.extensions, '.js']);
        if (target === null) {
          report(file, 'missing-dependency', `Relative import "${specifier}" does not resolve to a file.`);
          continue;
        }
        if (policy.bridge && !fileSet.has(target)) {
          const intoBridge = target.startsWith(`${policy.bridge.root}/`);
          // Pure answer and disclosure decisions still in the legacy interface: one source for both
          // interfaces until the legacy one retires and they move into the host.
          const intoHost = policy.bridge.hostRoots.some((prefix) => target.startsWith(prefix))
            || (policy.bridge.legacyDecisionModules ?? []).includes(target);
          if (intoBridge || intoHost) {
            if (!layer.bridge) report(file, 'bridge-access', `${layerName} may not reach the API bridge or host ("${specifier}"); only infrastructure adapts it.`);
            else if (intoBridge && !bridge.entries.has(target)) report(file, 'internal-access', `"${specifier}" is not a public entry of the API bridge.`);
            continue;
          }
        }
        if (packageRootOf(target, policy) !== packageRootOf(file, policy)) {
          report(file, 'cross-package', `"${specifier}" reaches into another package by path. Import its public name instead.`);
          continue;
        }
        if (!fileSet.has(target)) {
          report(file, 'unclassified', `"${specifier}" resolves to ${target}, which is outside the checked source roots.`);
          continue;
        }
        edges.add(target);
        const targetLayer = layerOf(target, policy);
        if (typeof targetLayer !== 'string') continue;
        if (!layer.dependsOn.includes(targetLayer)) report(file, 'layer', `${layerName} may not depend on ${targetLayer} ("${specifier}").`);
        const from = featureOf(file);
        const to = featureOf(target);
        if (from && to && from !== to) report(file, 'cross-feature', `Feature "${from}" may not import feature "${to}" ("${specifier}").`);
        continue;
      }
      const owner = Object.entries(policy.workspacePackages).find(([name]) => specifier === name || specifier.startsWith(`${name}/`));
      if (owner) {
        const [name, spec] = owner;
        const entry = specifier === name ? '.' : `.${specifier.slice(name.length)}`;
        if (!spec.entries.includes(entry)) report(file, 'internal-access', `"${specifier}" is not a public entry of ${name}.`);
        if (packageRootOf(file, policy) === spec.root) report(file, 'self-import', `${name} must import its own files by relative path.`);
        else if (!layer.dependsOn.includes(spec.layer)) report(file, 'layer', `${layerName} may not depend on ${spec.layer} ("${specifier}").`);
        continue;
      }
      if (!layer.packages.includes(specifier)) {
        report(file, 'external-package', `${layerName} may not import "${specifier}". Allowed: ${JSON.stringify(layer.packages)}.`);
      }
    }

    if (layer.reactSymbols) {
      for (const name of facts.reactImports) {
        if (!layer.reactSymbols.includes(name)) {
          report(file, 'react-symbol', `${layerName} may not import "${name}" from react. Allowed: ${layer.reactSymbols.join(', ')}.`);
        }
      }
    }

    if (!layer.markup) {
      for (const element of new Set(facts.intrinsicElements)) {
        report(file, 'markup', `${layerName} may not render <${element}>. Compose @reploid/poolday-ui components instead.`);
      }
      for (const attribute of new Set(facts.markupAttributes)) {
        if (policy.markupAttributes.includes(attribute)) {
          report(file, 'markup', `${layerName} may not set "${attribute}". Layout and styling belong to @reploid/poolday-ui.`);
        }
      }
    } else if (layer.styleParams) {
      for (const keys of facts.styleKeys) {
        if (keys === null || keys.some((key) => typeof key !== 'string' || !key.startsWith('--pool-param-'))) {
          report(file, 'style-param', 'A style may set only --pool-param-* parameters, as an object literal; the stylesheet decides the look.');
        }
      }
    }

    for (const value of facts.strings) {
      const match = literalPattern.exec(value);
      if (match) report(file, 'style-literal', `Literal "${match[0]}": colours, sizes and durations come from tokens.`);
    }

    if (!layer.platform) {
      for (const name of new Set(facts.identifiers)) {
        if (policy.platformGlobals.includes(name) && !facts.declared.has(name)) report(file, 'platform', `${layerName} may not use the platform global "${name}".`);
      }
    }
  }

  const cycle = findCycle(graph);
  if (cycle) report(cycle[0], 'cycle', `Dependency cycle: ${cycle.join(' -> ')}`);

  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule));
}

export const loadPolicy = (root) => JSON.parse(readFileSync(join(root, 'scripts', 'poolday-ui-architecture.json'), 'utf8'));

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const violations = checkArchitecture({ root, policy: loadPolicy(root) });
  if (violations.length === 0) {
    console.log('[poolday-ui] boundaries hold: components only, tokens only, a framework-free API bridge.');
  } else {
    for (const violation of violations) console.error(`${violation.file}: [${violation.rule}] ${violation.message}`);
    console.error(`\n${violations.length} violation(s). Fix the code; do not add exemptions.`);
    process.exit(1);
  }
}
