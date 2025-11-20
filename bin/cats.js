#!/usr/bin/env node
// PAWS Cats Bundle Creator
// Creates context bundles from file patterns

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

async function createCatsBundle(patterns, options = {}) {
  const { reason = 'Context bundle', output } = options;
  const files = [];

  // Expand patterns
  for (const pattern of patterns) {
    const matches = await glob(pattern, { cwd: process.cwd(), absolute: true });
    files.push(...matches);
  }

  // Dedupe and sort
  const uniqueFiles = [...new Set(files)].sort();

  if (uniqueFiles.length === 0) {
    console.error('No files matched the patterns');
    process.exit(1);
  }

  // Build bundle
  let bundle = `## PAWS Context Bundle (cats.md)
**Generated:** ${new Date().toISOString()}
**Files:** ${uniqueFiles.length}
**Reason:** ${reason}

---

`;

  for (const filePath of uniqueFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(process.cwd(), filePath);

      bundle += `\`\`\`vfs-file
path: /${relativePath}
\`\`\`
${content}
\`\`\`

---

`;
    } catch (err) {
      console.error(`Warning: Could not read ${filePath}: ${err.message}`);
    }
  }

  // Output
  if (output) {
    fs.writeFileSync(output, bundle);
    console.log(`Cats bundle written to ${output} (${uniqueFiles.length} files)`);
  } else {
    console.log(bundle);
  }

  return bundle;
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`Usage: cats.js <pattern> [pattern2...] [-o output.md] [-r "reason"]

Examples:
  cats.js "blueprints/*.md" -o blueprints.cats.md
  cats.js "core/*.js" "workflow/*.js" -r "Core modules"
  cats.js "blueprints/0x00000[1-5]*.md" -o core-blueprints.cats.md
`);
  process.exit(0);
}

// Parse args
const patterns = [];
let output = null;
let reason = 'Context bundle';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o' && args[i + 1]) {
    output = args[++i];
  } else if (args[i] === '-r' && args[i + 1]) {
    reason = args[++i];
  } else {
    patterns.push(args[i]);
  }
}

createCatsBundle(patterns, { output, reason }).catch(console.error);
