#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { build } from 'esbuild';
import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourcePath = path.join(repoRoot, 'sdk/change-passport/src/index.ts');
const outputDir = path.join(repoRoot, 'sdk/change-passport/dist');
const bundlePath = path.join(outputDir, 'index.js');
const declarationPath = path.join(outputDir, 'index.d.ts');
const checkOnly = process.argv.includes('--check');

const source = await fs.readFile(sourcePath, 'utf8');
const bundle = await build({
  entryPoints: [sourcePath],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  treeShaking: true,
  write: false,
  legalComments: 'none',
  logLevel: 'silent'
});
const bundleText = bundle.outputFiles[0]?.text;
if (!bundleText) throw new Error('Change Passport SDK bundle was not produced');

const declaration = ts.transpileDeclaration(source, {
  fileName: sourcePath,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true
  },
  reportDiagnostics: true
});
const declarationErrors = (declaration.diagnostics || []).filter((diagnostic) => (
  diagnostic.category === ts.DiagnosticCategory.Error
));
if (declarationErrors.length) {
  const host = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => repoRoot,
    getNewLine: () => '\n'
  };
  throw new Error(ts.formatDiagnostics(declarationErrors, host));
}
const declarationText = declaration.outputText;

const compare = async (filePath, expected) => {
  try {
    return await fs.readFile(filePath, 'utf8') === expected;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

if (checkOnly) {
  const [bundleMatches, declarationMatches] = await Promise.all([
    compare(bundlePath, bundleText),
    compare(declarationPath, declarationText)
  ]);
  if (!bundleMatches || !declarationMatches) {
    throw new Error([
      'Change Passport SDK distribution is stale.',
      !bundleMatches ? 'dist/index.js does not match the bundled source.' : null,
      !declarationMatches ? 'dist/index.d.ts does not match the typed source.' : null,
      'Run npm run build:change-passport-sdk.'
    ].filter(Boolean).join(' '));
  }
  process.stdout.write('[change-passport-sdk] checked-in bundle and declarations match source\n');
} else {
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(bundlePath, bundleText),
    fs.writeFile(declarationPath, declarationText)
  ]);
  process.stdout.write('[change-passport-sdk] wrote standalone bundle and declarations\n');
}
