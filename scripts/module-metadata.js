/**
 * Resolve forwarded browser metadata without importing or executing candidates.
 * Only static ESM bindings, object properties/spreads and Object.freeze are
 * supported. Unknown expressions fail closed; imports cannot escape rootDir.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';

const UNKNOWN = Symbol('unknown metadata');

export function createModuleMetadataResolver({ rootDir, readSource = (file) => readFile(file, 'utf8') }) {
  const root = path.resolve(rootDir);
  const modules = new Map();

  function bounded(file) {
    const absolute = path.resolve(file);
    const relative = path.relative(root, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Metadata import escapes browser source root');
    }
    return absolute;
  }

  function dependency(file, specifier) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
    return bounded(path.resolve(path.dirname(file), specifier));
  }

  function name(node) {
    return node?.name ?? node?.value;
  }

  async function moduleFor(file, source) {
    file = bounded(file);
    if (!modules.has(file)) {
      modules.set(file, (async () => {
        const ast = parse(source ?? await readSource(file), { ecmaVersion: 'latest', sourceType: 'module' });
        const bindings = new Map();
        const exports = new Map();
        const bind = (declaration) => {
          if (declaration?.type !== 'VariableDeclaration') return;
          for (const entry of declaration.declarations) {
            if (entry.id.type === 'Identifier') {
              bindings.set(entry.id.name, declaration.kind === 'const' ? { node: entry.init } : {});
            }
          }
        };
        for (const statement of ast.body) {
          bind(statement);
          if (statement.type === 'ImportDeclaration') {
            for (const entry of statement.specifiers) {
              bindings.set(entry.local.name, {
                source: statement.source.value,
                imported: entry.type === 'ImportDefaultSpecifier' ? 'default' : name(entry.imported)
              });
            }
          } else if (statement.type === 'ExportDefaultDeclaration') {
            exports.set('default', { node: statement.declaration });
          } else if (statement.type === 'ExportNamedDeclaration') {
            bind(statement.declaration);
            for (const entry of statement.declaration?.declarations || []) {
              if (entry.id.type === 'Identifier') exports.set(entry.id.name, { local: entry.id.name });
            }
            for (const entry of statement.specifiers) {
              exports.set(name(entry.exported), statement.source
                ? { source: statement.source.value, imported: name(entry.local) }
                : { local: name(entry.local) });
            }
          }
        }
        return { file, bindings, exports };
      })());
    }
    return modules.get(file);
  }

  async function guard(key, active, action) {
    if (active.has(key)) return UNKNOWN;
    const next = new Set(active);
    next.add(key);
    return action(next);
  }

  async function bindingValue(module, binding, fields, active) {
    if (!binding) return UNKNOWN;
    if (binding.source) {
      const file = dependency(module.file, binding.source);
      return file && binding.imported
        ? exportValue(await moduleFor(file), binding.imported, fields, active)
        : UNKNOWN;
    }
    if (binding.local) {
      return guard(`${module.file}:binding:${binding.local}:${fields.join('.')}`, active,
        (next) => bindingValue(module, module.bindings.get(binding.local), fields, next));
    }
    return expressionValue(module, binding.node, fields, active);
  }

  async function exportValue(module, exported, fields, active) {
    return guard(`${module.file}:export:${exported}:${fields.join('.')}`, active,
      (next) => bindingValue(module, module.exports.get(exported), fields, next));
  }

  async function expressionValue(module, node, fields, active) {
    if (!node) return UNKNOWN;
    return guard(`${module.file}:node:${node.start}:${fields.join('.')}`, active, async (next) => {
      if (node.type === 'Identifier') {
        return bindingValue(module, module.bindings.get(node.name), fields, next);
      }
      if (node.type === 'Literal') return fields.length ? UNKNOWN : node.value;
      if (node.type === 'MemberExpression') {
        const property = node.computed
          ? (node.property.type === 'Literal' ? node.property.value : UNKNOWN)
          : node.property.name;
        return property === UNKNOWN ? UNKNOWN
          : expressionValue(module, node.object, [String(property), ...fields], next);
      }
      if (node.type === 'CallExpression' && node.arguments.length === 1
        && node.callee.type === 'MemberExpression' && !node.callee.computed
        && node.callee.object.type === 'Identifier' && node.callee.object.name === 'Object'
        && !module.bindings.has('Object') && node.callee.property.name === 'freeze') {
        return expressionValue(module, node.arguments[0], fields, next);
      }
      if (node.type !== 'ObjectExpression' || !fields.length) return UNKNOWN;
      for (const property of [...node.properties].reverse()) {
        if (property.type === 'SpreadElement') {
          const value = await expressionValue(module, property.argument, fields, next);
          if (value !== undefined) return value;
          continue;
        }
        if (property.computed && property.key.type !== 'Literal') return UNKNOWN;
        if (String(name(property.key)) !== fields[0]) continue;
        if (property.kind !== 'init') return UNKNOWN;
        return expressionValue(module, property.value, fields.slice(1), next);
      }
      return undefined;
    });
  }

  return async (file, source) => {
    const module = await moduleFor(file, source);
    const id = await exportValue(module, 'default', ['metadata', 'id'], new Set());
    const introduced = await exportValue(module, 'default', ['metadata', 'genesis', 'introduced'], new Set());
    return {
      id: typeof id === 'string' ? id : null,
      introduced: typeof introduced === 'string' ? introduced : null
    };
  };
}
