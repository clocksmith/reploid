#!/usr/bin/env node
/** Compare value exports through TypeScript's resolver, including aliases and
 * export-star chains, and check request-type paths against runtime policy.
 * Type-only declarations are not runtime exports. This does not prove semantic
 * equivalence of every JavaScript implementation and declared signature. */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const repository = path.resolve(import.meta.dirname, '..');
const root = path.join(repository, process.argv.includes('--poolday') ? 'apps/poolday' : 'packages/reploid/src');
const pairs = fs.readdirSync(root, { recursive: true }).filter(name => name.endsWith('.d.ts')
  && fs.existsSync(path.join(root, name.slice(0, -5) + '.js')));
const program = ts.createProgram(pairs.flatMap(name => [path.join(root, name), path.join(root, name.slice(0, -5) + '.js')]), {
  allowJs: true, checkJs: false, noEmit: true, target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true
});
const checker = program.getTypeChecker();
const exportsOf = file => {
  const source = program.getSourceFile(file), symbol = source && checker.getSymbolAtLocation(source);
  if (!symbol) throw new Error(`No module symbol for ${path.relative(repository, file)}`);
  return new Set(checker.getExportsOfModule(symbol).filter(entry => {
    const target = entry.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(entry) : entry;
    return target.flags & ts.SymbolFlags.Value;
  }).map(entry => entry.name));
};
let failures = 0;
for (const name of pairs) {
  const runtime = exportsOf(path.join(root, name.slice(0, -5) + '.js')), declared = exportsOf(path.join(root, name));
  const missing = [...runtime].filter(name => !declared.has(name)), extra = [...declared].filter(name => !runtime.has(name));
  if (missing.length || extra.length) {
    failures++;
    console.error(`${path.relative(repository, path.join(root, name))}: ${JSON.stringify({ missing, extra })}`);
  }
}
// Request policy is a runtime authority contract; check its declaration through
// the compiler rather than duplicating an allowlist in a separate test fixture.
if (!process.argv.includes('--poolday')) {
  const source = program.getSourceFile(path.join(root, 'config/index.d.ts'));
  const module = source && checker.getSymbolAtLocation(source);
  const declaration = module && checker.getExportsOfModule(module).find(entry => entry.name === 'RequestOverrides');
  if (!declaration) throw new Error('Public RequestOverrides declaration is missing');
  const pathsOf = (type, prefix = '') => {
    const value = checker.getNonNullableType(type);
    if (!(value.flags & ts.TypeFlags.Object) || checker.isArrayType(value) || checker.isTupleType(value)) return [prefix];
    const fields = checker.getPropertiesOfType(value);
    if (!fields.length) return [prefix];
    return fields.flatMap(field => pathsOf(checker.getTypeOfSymbolAtLocation(field, source),
      prefix ? `${prefix}.${field.name}` : field.name));
  };
  const declared = pathsOf(checker.getDeclaredTypeOfSymbol(declaration)).sort();
  const allowed = JSON.parse(fs.readFileSync(path.join(root, 'config/request-overrides.json'), 'utf8')).paths.slice().sort();
  if (JSON.stringify(declared) !== JSON.stringify(allowed)) {
    failures++;
    console.error(`Request override type differs from runtime policy: ${JSON.stringify({ declared, allowed })}`);
  }
}
console.log(`Declaration exports: ${pairs.length} module pairs, ${failures} mismatches`);
if (failures) process.exitCode = 1;
