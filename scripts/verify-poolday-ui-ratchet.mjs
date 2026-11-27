#!/usr/bin/env node
/**
 * Every Poolday screen is React built from packages/poolday-ui; the vanilla interface is deleted.
 * This check rejects any of the following in the former vanilla UI directories:
 *   rawControls        raw interactive elements written by hand (button, input, select, textarea,
 *                      details, summary, dialog, a) in markup strings or createElement calls
 *   classAttributes    hand-written class attributes and className assignments
 *   compositionClasses bespoke classes a composition stylesheet defines (there are none)
 *   compositionRules   rules in a composition stylesheet
 *
 * Usage: node scripts/verify-poolday-ui-ratchet.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_SCRIPT_DIRS = ['apps/poolday/ui/pool-home', 'apps/poolday/ui/components', 'apps/poolday/host'];
const LEGACY_STYLE_DIR = 'apps/poolday/styles/poolday/compositions';

const RAW_CONTROL = /<(?:button|input|select|textarea|details|summary|dialog|a)[\s>]|createElement\(\s*['"](?:button|input|select|textarea|details|summary|dialog|a)['"]/g;
const CLASS_ATTRIBUTE = /\bclass=\\?["']|\.className\s*=(?!=)|classList\.(?:add|toggle)\(/g;

const filesIn = (root, dir, extension) => {
  const full = path.join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((name) => name.endsWith(extension)).sort().map((name) => path.join(full, name));
};

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Counts of vanilla UI code in the former composition directories. */
function measureLegacy(root) {
  let rawControls = 0;
  let classAttributes = 0;
  for (const dir of LEGACY_SCRIPT_DIRS) {
    for (const file of filesIn(root, dir, '.js')) {
      const text = readFileSync(file, 'utf8');
      rawControls += (text.match(RAW_CONTROL) ?? []).length;
      classAttributes += (text.match(CLASS_ATTRIBUTE) ?? []).length;
    }
  }
  const classes = new Set();
  let compositionRules = 0;
  for (const file of filesIn(root, LEGACY_STYLE_DIR, '.css')) {
    const css = stripCssComments(readFileSync(file, 'utf8'));
    for (const match of css.matchAll(/([^{}]+)\{/g)) {
      const prelude = match[1].trim();
      if (!prelude || prelude.startsWith('@') || /^(from|to|\d+%)/.test(prelude)) continue;
      compositionRules += 1;
      for (const name of prelude.matchAll(/\.([a-z][\w-]*)/g)) classes.add(name[1]);
    }
  }
  return { rawControls, classAttributes, compositionClasses: classes.size, compositionRules };
}

export function legacyUiViolations(root = ROOT) {
  return Object.entries(measureLegacy(root))
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}: ${count}. Build the screen from @reploid/poolday-ui.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const violations = legacyUiViolations();
  if (violations.length) {
    console.error(`[poolday-legacy-ui] found legacy UI:\n  ${violations.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log('[poolday-legacy-ui] no legacy UI found');
  }
}
