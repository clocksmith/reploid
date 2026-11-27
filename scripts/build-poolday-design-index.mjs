#!/usr/bin/env node
/**
 * Reads the Poolday design system from its sources and writes the index the /design page renders:
 *   tokens       apps/poolday/styles/poolday/tokens.css (values per theme, use counts)
 *   primitives   the components exported by packages/poolday-ui, the primitive classes each one
 *                renders and the tokens those classes' rules read
 *   compositions the screens exported by apps/poolday-react/src/features/<feature>/presentation,
 *                and the components each one composes
 * Nothing is copied by hand, so "in use" holds in both directions. Token values are not copied
 * either: the page reads them from tokens.css when it loads.
 *
 * Usage: node scripts/build-poolday-design-index.mjs [--check]
 */
import { parse } from '@babel/parser';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = path.join(ROOT, 'apps/poolday/styles/poolday');
const UI_SRC = path.join(ROOT, 'packages/poolday-ui/src');
const FEATURES = path.join(ROOT, 'apps/poolday-react/src/features');
export const OUTPUT = path.join(ROOT, 'apps/poolday-react/src/app/designIndex.generated.ts');

/** Simplest to most complex. Every component the package exports appears exactly once. */
export const PRIMITIVE_ORDER = [
  'PooldayRoot', 'Text', 'Prose', 'Wordmark', 'VisuallyHidden', 'Facts', 'Stats', 'CodeBlock', 'ShareBar', 'Icon', 'Badge', 'StatusDot', 'StatusLine', 'Spinner', 'Progress',
  'Readout', 'Divider', 'Stack', 'Row', 'Columns', 'Grow', 'Toolbar', 'Log', 'Surface', 'Card', 'Frame', 'Button', 'IconButton', 'Chip', 'SelectorButton', 'Menu',
  'Field', 'FilePicker', 'TextArea', 'InputGroup', 'Toggle', 'SingleChoice', 'MultiChoice', 'ListItem', 'List', 'Section',
  'Disclosure', 'Notice', 'MessageText', 'MessageRow', 'Transcript', 'ConversationLayout', 'ThreadItem', 'Navigator', 'SidebarLayout',
  'BarButton', 'WorkspaceBar', 'Drawer', 'Workspace', 'Dialog', 'Sheet', 'TokenSwatch',
];
/** Small pieces first, whole screens last. */
export const COMPOSITION_ORDER = [
  'ComposerBar', 'AnswerOnSheet', 'PrivacyDialog', 'DownloadDialog', 'RenameDialog', 'RemotePermissionDialog', 'ThreadsPanel', 'ChatWorkspace',
  'ConversationProvider', 'ActivityList', 'FleetAccount', 'YourComputers', 'PublicNetwork', 'ThisComputer', 'PairingLinkDialog', 'ComputersPanel',
  'ConversationDetailsPanel', 'SettingsPanel',
];

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const varRefs = (value) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

/** Declarations and rules of one stylesheet, with the block context of each. */
function parseCss(css) {
  const declarations = [];
  const rules = [];
  const stack = [];
  let buffer = '';
  for (const ch of stripComments(css)) {
    if (ch === '{') {
      const prelude = buffer.trim();
      stack.push({ prelude, refs: [] });
      buffer = '';
    } else if (ch === '}') {
      const block = stack.pop();
      if (block && !block.prelude.startsWith('@')) rules.push({ selector: block.prelude, refs: block.refs });
      buffer = '';
    } else if (ch === ';') {
      const text = buffer.trim();
      buffer = '';
      const colon = text.indexOf(':');
      if (colon < 0 || !stack.length) continue;
      const property = text.slice(0, colon).trim();
      const value = text.slice(colon + 1).trim().replace(/\s+/g, ' ');
      const context = stack.map((entry) => entry.prelude).join(' > ');
      declarations.push({ property, value, light: /theme='light'/.test(context), media: context.includes('@media') });
      stack.at(-1).refs.push(...varRefs(value));
    } else buffer += ch;
  }
  return { declarations, rules };
}

function tokenKind(name, value) {
  if (/^--pool-font-/.test(name)) return 'family';
  if (/^--pool-weight-/.test(name)) return 'weight';
  if (/^--pool-text-(micro|xs|sm|base|lg|xl|2xl|display)$/.test(name)) return 'text';
  if (/^--pool-radius-/.test(name)) return 'radius';
  if (/^--pool-border-/.test(name)) return 'border';
  if (/shadow/.test(name)) return 'shadow';
  if (/^--pool-surface-backdrop$/.test(name)) return 'none';
  if (/gradient\(|url\(/.test(value) || /^--pool-surface-/.test(name)) return 'image';
  if (/^--pool-color-/.test(name) && !/^--pool-color-.*-(x|y)$/.test(name)) return 'color';
  if (/^-?[\d.]+px$/.test(value) || /^--pool-(size|space)-/.test(name)) return 'length';
  return 'none';
}

const groupOf = (name) => {
  const rest = name.replace(/^--pool-/, '');
  const known = ['alpha', 'size', 'radius', 'border', 'text', 'leading', 'weight', 'tracking', 'font', 'duration', 'ease',
    'z', 'color', 'surface', 'shadow', 'space'];
  return known.find((prefix) => rest === prefix || rest.startsWith(`${prefix}-`)) ?? 'other';
};

function readStyles() {
  const manifest = JSON.parse(readFileSync(path.join(STYLES, 'layers.json'), 'utf8'));
  const tokenCss = parseCss(readFileSync(path.join(STYLES, manifest.tokens), 'utf8'));
  const tokens = new Map();
  for (const { property, value, light, media } of tokenCss.declarations) {
    if (!property.startsWith('--pool-') || media) continue;
    const entry = tokens.get(property) ?? { name: property, dark: null, light: null, refs: new Set() };
    if (light) entry.light = value;
    else entry.dark ??= value;
    for (const ref of varRefs(value)) entry.refs.add(ref);
    tokens.set(property, entry);
  }
  const uses = new Map();
  const count = (refs) => { for (const ref of refs) uses.set(ref, (uses.get(ref) ?? 0) + 1); };
  for (const { value } of tokenCss.declarations) count(varRefs(value));
  const primitiveRules = [];
  for (const file of manifest.primitives) {
    const { rules, declarations } = parseCss(readFileSync(path.join(STYLES, file), 'utf8'));
    for (const rule of rules) primitiveRules.push({ ...rule, file });
    count(declarations.flatMap(({ value }) => varRefs(value)));
  }
  for (const file of manifest.compositions) {
    const { declarations } = parseCss(readFileSync(path.join(STYLES, file), 'utf8'));
    count(declarations.flatMap(({ value }) => varRefs(value)));
  }
  // A script that reads a token by name (getComputedStyle(node).getPropertyValue('--pool-…')) uses it as well: a
  // token no stylesheet references can still drive behaviour, so it must not be reported as unused.
  for (const file of scriptSources()) count(scriptTokenNames(readFileSync(file, 'utf8')).filter((name) => tokens.has(name)));
  return { tokens, uses, primitiveRules };
}

/** Hand-written Poolday scripts: the vanilla UI, the host, the React app and the design system. Built bundles are skipped. */
const SCRIPT_ROOTS = ['apps/poolday/ui', 'apps/poolday/host', 'apps/poolday-react/src', 'packages/poolday-ui/src'];
const BUILT = [/\/ui\/react\//, /\.bundle\.js$/, /\.generated\.ts$/];
function scriptSources() {
  const found = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(js|mjs|ts|tsx)$/.test(entry.name) && !BUILT.some((pattern) => pattern.test(file))) found.push(file);
    }
  };
  for (const root of SCRIPT_ROOTS) visit(path.join(ROOT, root));
  return found;
}
/** Token names a script names in a string literal, each counted once per file. */
const scriptTokenNames = (source) => [...new Set([...source.matchAll(/['"`](--pool-[a-z0-9-]+)['"`]/g)].map((m) => m[1]))];

/** Top-level declarations and named imports of one module. */
function readModule(file) {
  const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const declarations = new Map();
  const imports = new Map();
  const exported = [];
  for (const statement of ast.program.body) {
    const node = statement.type === 'ExportNamedDeclaration' && statement.declaration ? statement.declaration : statement;
    if (node.type === 'FunctionDeclaration' && node.id) {
      declarations.set(node.id.name, node);
      if (statement !== node) exported.push(node.id.name);
    } else if (node.type === 'VariableDeclaration') {
      for (const declarator of node.declarations) {
        if (declarator.id.type === 'Identifier') declarations.set(declarator.id.name, declarator);
      }
    } else if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier') {
          imports.set(specifier.local.name, { source: node.source.value, name: specifier.imported.name ?? specifier.imported.value });
        }
      }
    }
  }
  return { file, declarations, imports, exported };
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

/** Literals (class names, prefixes) and the names a declaration references. */
function factsOf(node) {
  const words = new Set();
  const prefixes = new Set();
  const names = new Set();
  walk(node, (child) => {
    if (child.type === 'StringLiteral') for (const word of child.value.split(/\s+/)) words.add(word);
    if (child.type === 'TemplateLiteral') {
      child.quasis.forEach((quasi, index) => {
        const parts = quasi.value.cooked.split(/\s+/);
        parts.forEach((part, partIndex) => {
          if (index < child.expressions.length && partIndex === parts.length - 1) prefixes.add(part);
          else words.add(part);
        });
      });
    }
    if (child.type === 'Identifier' || child.type === 'JSXIdentifier') names.add(child.name);
  });
  return { words, prefixes, names };
}

const CLASS = /^(pool|btn)-[a-z0-9-]+$/;

function resolveImport(fromFile, source) {
  if (!source.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), source).replace(/\.js$/, '');
  return ['.tsx', '.ts'].map((ext) => base + ext).find((candidate) => existsSync(candidate)) ?? null;
}

/** Classes a component renders, following its local helpers, constants and the components it renders. */
function classesOf(modules, file, name, cssClasses, seen = new Set()) {
  const key = `${file}#${name}`;
  if (seen.has(key)) return new Set();
  seen.add(key);
  const module = modules.get(file);
  const declaration = module?.declarations.get(name);
  const classes = new Set();
  if (!declaration) {
    const imported = module?.imports.get(name);
    const target = imported && resolveImport(file, imported.source);
    if (target && modules.has(target)) for (const value of classesOf(modules, target, imported.name, cssClasses, seen)) classes.add(value);
    return classes;
  }
  const { words, prefixes, names } = factsOf(declaration);
  for (const word of words) if (CLASS.test(word)) classes.add(word);
  for (const prefix of prefixes) {
    if (!/^(pool|btn)-[a-z0-9-]*-$/.test(prefix)) continue;
    for (const css of cssClasses) if (css.startsWith(prefix)) classes.add(css);
  }
  for (const other of names) {
    if (other === name) continue;
    if (module.declarations.has(other) || module.imports.has(other)) {
      for (const value of classesOf(modules, file, other, cssClasses, seen)) classes.add(value);
    }
  }
  return classes;
}

/** Exported components a component renders, through its local helpers and the components it renders. */
function componentsOf(modules, file, name, exported, seen = new Set()) {
  const key = `${file}#${name}`;
  const found = new Set();
  if (seen.has(key)) return found;
  seen.add(key);
  const module = modules.get(file);
  const declaration = module?.declarations.get(name);
  if (!declaration) {
    const imported = module?.imports.get(name);
    const target = imported && resolveImport(file, imported.source);
    if (target && modules.has(target)) {
      if (exported.has(imported.name)) found.add(imported.name);
      for (const value of componentsOf(modules, target, imported.name, exported, seen)) found.add(value);
    }
    return found;
  }
  for (const other of factsOf(declaration).names) {
    if (other === name || !(module.declarations.has(other) || module.imports.has(other))) continue;
    if (module.declarations.has(other) && exported.has(other)) found.add(other);
    for (const value of componentsOf(modules, file, other, exported, seen)) found.add(value);
  }
  return found;
}

function loadModules(dir, recursive = false) {
  const modules = new Map();
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && recursive) visit(full);
      else if (/\.tsx?$/.test(entry.name)) modules.set(full, readModule(full));
    }
  };
  if (existsSync(dir)) visit(dir);
  return modules;
}

export function buildDesignIndex() {
  const { tokens, uses, primitiveRules } = readStyles();
  const ruleClasses = primitiveRules.map((rule) => new Set([...rule.selector.matchAll(/\.((?:pool|btn)-[\w-]+)/g)].map((m) => m[1])));
  const cssClasses = new Set(ruleClasses.flatMap((set) => [...set]));

  const uiModules = loadModules(UI_SRC);
  const indexSource = readFileSync(path.join(UI_SRC, 'index.ts'), 'utf8');
  const exportedNames = new Map();
  for (const match of indexSource.matchAll(/export \{([^}]*)\} from '\.\/([\w-]+)\.js'/g)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim();
      if (/^[A-Z]/.test(name) && !name.startsWith('type ')) exportedNames.set(name, path.join(UI_SRC, `${match[2]}.tsx`));
    }
  }
  const components = [...exportedNames.entries()].filter(([name, file]) => uiModules.get(file)?.declarations.get(name)?.type === 'FunctionDeclaration');
  const missing = components.map(([name]) => name).filter((name) => !PRIMITIVE_ORDER.includes(name));
  const extra = PRIMITIVE_ORDER.filter((name) => !components.some(([component]) => component === name));
  if (missing.length || extra.length) throw new Error(`PRIMITIVE_ORDER differs from the package exports (missing ${missing.join(', ') || 'none'}; stale ${extra.join(', ') || 'none'})`);

  const closure = (names) => {
    const out = new Set();
    const queue = [...names];
    while (queue.length) {
      const name = queue.pop();
      if (out.has(name) || !tokens.has(name)) continue;
      out.add(name);
      queue.push(...tokens.get(name).refs);
    }
    return out;
  };

  const primitives = components
    .sort(([a], [b]) => PRIMITIVE_ORDER.indexOf(a) - PRIMITIVE_ORDER.indexOf(b))
    .map(([name, file]) => {
      const classes = classesOf(uiModules, file, name, cssClasses);
      const direct = new Set();
      primitiveRules.forEach((rule, i) => {
        const own = [...ruleClasses[i]].filter((value) => value !== 'pool-home');
        const matches = own.length ? own.some((value) => classes.has(value)) : name === 'PooldayRoot';
        if (matches) for (const ref of rule.refs) direct.add(ref);
      });
      return { name, file: path.relative(ROOT, file), classes: [...classes].sort(), tokens: [...closure(direct)].sort() };
    });

  // Compositions: exported screens of each feature except the design page itself.
  const compositions = [];
  const featureDirs = existsSync(FEATURES) ? readdirSync(FEATURES).filter((name) => name !== 'design').sort() : [];
  const uiNames = new Set(components.map(([name]) => name));
  const screenModules = new Map();
  for (const feature of featureDirs) {
    for (const [file, module] of loadModules(path.join(FEATURES, feature, 'presentation'))) screenModules.set(file, { ...module, feature });
  }
  const usedPrimitives = (file, name, seen = new Set()) => {
    const key = `${file}#${name}`;
    const out = new Set();
    if (seen.has(key)) return out;
    seen.add(key);
    const module = screenModules.get(file);
    const declaration = module?.declarations.get(name);
    if (!declaration) {
      const imported = module?.imports.get(name);
      if (imported?.source === '@reploid/poolday-ui' && uiNames.has(imported.name)) out.add(imported.name);
      const target = imported && resolveImport(file, imported.source);
      if (target && screenModules.has(target)) for (const value of usedPrimitives(target, imported.name, seen)) out.add(value);
      return out;
    }
    for (const other of factsOf(declaration).names) {
      if (other !== name && (module.declarations.has(other) || module.imports.has(other))) {
        for (const value of usedPrimitives(file, other, seen)) out.add(value);
      }
    }
    return out;
  };
  // A composition also uses what its components render (a Button renders an Icon).
  const exportedSet = new Set(uiNames);
  const renders = new Map(components.map(([name, file]) => [name, componentsOf(uiModules, file, name, exportedSet)]));
  for (const [file, module] of screenModules) {
    for (const name of module.exported) {
      if (!/^[A-Z]/.test(name)) continue;
      const used = new Set(usedPrimitives(file, name));
      for (const direct of [...used]) for (const inner of renders.get(direct) ?? []) used.add(inner);
      compositions.push({ name, feature: module.feature, primitives: [...used].sort((a, b) => PRIMITIVE_ORDER.indexOf(a) - PRIMITIVE_ORDER.indexOf(b)) });
    }
  }
  const rank = (name) => (COMPOSITION_ORDER.includes(name) ? COMPOSITION_ORDER.indexOf(name) : COMPOSITION_ORDER.length);
  compositions.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));

  const primitiveRecords = primitives.map((primitive) => ({
    ...primitive,
    compositions: compositions.filter((composition) => composition.primitives.includes(primitive.name)).map((composition) => composition.name),
  }));
  const tokenRecords = [...tokens.values()].map((token) => {
    const dark = token.dark ?? token.light ?? '';
    const light = token.light !== null && token.light !== dark ? token.light : null;
    return {
      name: token.name,
      group: groupOf(token.name),
      layer: token.refs.size === 0 && light === null ? 'raw' : 'semantic',
      kind: tokenKind(token.name, dark),
      themed: light !== null,
      uses: uses.get(token.name) ?? 0,
      primitives: primitiveRecords.filter((primitive) => primitive.tokens.includes(token.name)).map((primitive) => primitive.name),
    };
  });
  return { tokens: tokenRecords, primitives: primitiveRecords, compositions };
}

export function renderDesignIndex(index) {
  return `// Generated by scripts/build-poolday-design-index.mjs from the design system's sources. Do not edit.\n`
    + `import type { DesignIndex } from '../features/design/domain/designIndex';\n\n`
    + `export const designIndex: DesignIndex = {\n`
    + Object.entries(index).map(([key, rows]) => `  ${key}: [\n${rows.map((row) => `    ${JSON.stringify(row)},`).join('\n')}\n  ],`).join('\n')
    + `\n};\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = renderDesignIndex(buildDesignIndex());
  if (process.argv.includes('--check')) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
    if (current !== text) {
      console.error('[poolday-design-index] stale; run node scripts/build-poolday-design-index.mjs');
      process.exit(1);
    }
    console.log('[poolday-design-index] current');
  } else {
    writeFileSync(OUTPUT, text);
    console.log(`[poolday-design-index] wrote ${path.relative(ROOT, OUTPUT)}`);
  }
}
