#!/usr/bin/env node
// Derive the optional consumer's types from the installed public partition API.
import ts from 'typescript';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { resolveServedFile } from '../server/browser-roots.js';

const root = resolve(import.meta.dirname, '..');
const packageRoot = resolve(root, 'node_modules/dopplerx');
const metadata = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
const entry = metadata.exports['./partitions'].types;
const entryFile = resolve(packageRoot, entry);
const program = ts.createProgram([entryFile], { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
const checker = program.getTypeChecker();
const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(entryFile)));
const names = ['LAYER_PARTITION_SCHEMA', 'ACTIVATION_TENSOR_SCHEMA', 'ActivationDtype', 'PartitionTensorContract',
  'LayerPartition', 'LayerPartitionPlan', 'ActivationFrame', 'PartitionTiming', 'ResidentPartitionAllocation',
  'ResidentPartitionDescriptor', 'ResidentPartitionIdentity', 'ResidentPartitionLimits', 'ResidentPartitionStep',
  'ResidentPartitionTokenizationRequest', 'ResidentPartitionTokenizationResult', 'ResidentPartitionARequest',
  'ResidentPartitionAResult', 'ResidentPartitionBRequest', 'ResidentPartitionBResult', 'ResidentPartitionMetrics',
  'ResidentRecoveryCapabilities', 'ResidentPartitionSession'];
// Follow compiler-resolved type references as well as the selected entry names.
// Copying only entry declarations leaves dangling names as the public API grows.
const projected = new Map();
const inlineTypeReferences = new Map();
const indexedReturnReferences = new Map();
const hostTypes = new Set(['GenerationOptions', 'ResolvedGenerationOptions']);

function resolveIndexedReturn(node) {
  if (!ts.isTypeReferenceNode(node) || node.typeName.getText() !== 'ReturnType') return null;
  const [indexed] = node.typeArguments ?? [];
  if (!indexed || !ts.isIndexedAccessTypeNode(indexed) || !ts.isLiteralTypeNode(indexed.indexType)
    || !ts.isStringLiteral(indexed.indexType.literal)) return null;

  const owner = checker.getTypeFromTypeNode(indexed.objectType);
  const member = checker.getPropertyOfType(owner, indexed.indexType.literal.text);
  const declarations = member?.declarations ?? [];
  // Overloads and indirect callables must be handled explicitly before projection.
  if (declarations.length !== 1) throw new Error(`Cannot project ${node.getText()}`);
  const [declaration] = declarations;
  if ((!ts.isMethodDeclaration(declaration) && !ts.isMethodSignature(declaration)) || !declaration.type) {
    throw new Error(`Cannot project ${node.getText()} without a declared method return`);
  }
  return declaration.type;
}

function project(symbol) {
  if (!symbol) return;
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  if (hostTypes.has(symbol.name) || projected.has(symbol.name)) return;
  let declaration = symbol.declarations?.[0];
  if (!declaration || !declaration.getSourceFile().fileName.startsWith(packageRoot + '/')) return;
  if (ts.isVariableDeclaration(declaration)) declaration = declaration.parent.parent;
  if (!ts.isInterfaceDeclaration(declaration) && !ts.isTypeAliasDeclaration(declaration)
    && !ts.isVariableStatement(declaration)) return;
  projected.set(symbol.name, declaration);
  function visit(node) {
    const returnType = resolveIndexedReturn(node);
    if (returnType) {
      // Preserve the exposed method result without importing its private class.
      indexedReturnReferences.set(node.getText(), returnType.getText());
      visit(returnType);
      return;
    }
    if (ts.isImportTypeNode(node) && !node.isTypeOf && node.qualifier && ts.isIdentifier(node.qualifier)) {
      const imported = checker.getSymbolAtLocation(node.qualifier);
      project(imported);
      const name = node.qualifier.text;
      if (!projected.has(name) && !hostTypes.has(name)) {
        throw new Error(`Public partition import type ${node.getText()} is unresolved`);
      }
      const prefixLength = node.qualifier.getEnd() - node.getStart();
      inlineTypeReferences.set(node.getText().slice(0, prefixLength), name);
    }
    const reference = ts.isTypeReferenceNode(node) ? node.typeName
      : ts.isExpressionWithTypeArguments(node) ? node.expression
      : ts.isTypeQueryNode(node) ? node.exprName : null;
    if (reference) project(checker.getSymbolAtLocation(reference));
    ts.forEachChild(node, visit);
  }
  visit(declaration);
}
for (const name of names) {
  const symbol = exports.find(value => value.name === name);
  if (!symbol) throw new Error(`Installed public partitions API is missing ${name}`);
  project(symbol);
  if (!projected.has(name)) throw new Error(`No public declaration for ${name}`);
}
const declarations = [...projected.values()].map(declaration => declaration.getText());
let body = declarations.join('\n\n');
for (const [reference, type] of indexedReturnReferences) body = body.replaceAll(reference, type);
for (const [inlineType, name] of inlineTypeReferences) body = body.replaceAll(inlineType, name);
if (/import\(/.test(body)) throw new Error('Public partition types gained an unprojected dependency');
const output = '// Generated by scripts/sync-doppler-partition-contract.js from installed dopplerx/partitions.\n'
  + "import type { GenerationOptions, ResolvedGenerationOptions } from './config/doppler-generation-contract.js';\n"
  + body + '\n';
const provenance = JSON.stringify({ schema: 'reploid.doppler-partition-types/v1', packageVersion: metadata.version,
  publicExport: './partitions', exportedTypes: names, dependencyTypes: [...projected.keys()].filter(name => !names.includes(name)),
  sha256: createHash('sha256').update(output).digest('hex') }, null, 2) + '\n';
for (const [name, content] of [['doppler-partitions.d.ts', output], ['doppler-partitions.provenance.json', provenance]]) {
  const file = resolve(root, 'packages/reploid/src/contracts', name);
  if (process.argv.includes('--check')) {
    if (await readFile(file, 'utf8') !== content) throw new Error(`${name} differs from installed public partition types`);
  } else await writeFile(file, content);
}
console.log('Partition types match the installed public Doppler API.');

// History needs the public metadata codec, not the inference module graph.
// Bundle the installed implementation; never maintain a second hashing recipe.
const digest = await build({ absWorkingDir: root,
  stdin: { contents: "export { metadataDigest } from 'dopplerx/partitions';", resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  treeShaking: true, external: ['node:*'], metafile: true });
if (Object.values(digest.metafile.outputs).some(output => output.imports.length)) {
  throw new Error('Doppler history metadata bundle must not retain runtime imports');
}
const digestOutput = '// Generated by scripts/sync-doppler-partition-contract.js from installed dopplerx/partitions.\n'
  + digest.outputFiles[0].text;
const digestProvenance = JSON.stringify({ schema: 'reploid.doppler-metadata-contract/v1',
  packageVersion: metadata.version, publicExport: './partitions', exports: ['metadataDigest'],
  sha256: createHash('sha256').update(digestOutput).digest('hex') }, null, 2) + '\n';
for (const [name, content] of [['doppler-metadata-contract.js', digestOutput], ['doppler-metadata-contract.provenance.json', digestProvenance]]) {
  const file = resolveServedFile('config/' + name);
  if (process.argv.includes('--check')) {
    if (await readFile(file, 'utf8') !== content) throw new Error(`${name} differs from installed public Doppler metadata API`);
  } else await writeFile(file, content);
}
