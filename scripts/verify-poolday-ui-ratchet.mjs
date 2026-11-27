#!/usr/bin/env node
/**
 * Every Poolday screen is React built from packages/poolday-ui; the vanilla interface is deleted.
 * This ratchet counts markup written outside the design system (it records zero for each) and
 * fails when any count rises:
 *   rawControls        raw interactive elements written by hand (button, input, select, textarea,
 *                      details, summary, dialog, a) in markup strings or createElement calls
 *   classAttributes    hand-written class attributes and className assignments
 *   compositionClasses bespoke classes a composition stylesheet defines (there are none)
 *   compositionRules   rules in a composition stylesheet
 *
 * Usage: node scripts/verify-poolday-ui-ratchet.mjs [--write]
 *   --write lowers the recorded counts to the current ones; it never raises one.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RATCHET_FILE = 'scripts/poolday-ui-ratchet.json';
export const LEGACY_SCRIPT_DIRS = ['apps/poolday/ui/pool-home', 'apps/poolday/ui/components', 'apps/poolday/host'];
export const LEGACY_STYLE_DIR = 'apps/poolday/styles/poolday/compositions';

const RAW_CONTROL = /<(?:button|input|select|textarea|details|summary|dialog|a)[\s>]|createElement\(\s*['"](?:button|input|select|textarea|details|summary|dialog|a)['"]/g;
const CLASS_ATTRIBUTE = /\bclass=\\?["']|\.className\s*=(?!=)|classList\.(?:add|toggle)\(/g;

const filesIn = (root, dir, extension) => {
  const full = path.join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((name) => name.endsWith(extension)).sort().map((name) => path.join(full, name));
};

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Current counts of everything still outside the design system. */
export function measureLegacy(root = ROOT) {
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

/** Violations where a count rose above the recorded one, and notes where it fell. */
export function compareRatchet(current, recorded) {
  const violations = [];
  const lowered = [];
  for (const [key, value] of Object.entries(current)) {
    const limit = recorded[key];
    if (typeof limit !== 'number') violations.push(`${key}: no recorded limit`);
    else if (value > limit) violations.push(`${key}: ${value} exceeds the recorded ${limit}; build the screen from @reploid/poolday-ui instead`);
    else if (value < limit) lowered.push(`${key}: ${value} (recorded ${limit})`);
  }
  return { violations, lowered };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = path.join(ROOT, RATCHET_FILE);
  const recorded = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const current = measureLegacy();
  const { violations, lowered } = compareRatchet(current, recorded);
  if (process.argv.includes('--write')) {
    if (violations.length && Object.keys(recorded).length) {
      console.error(`[poolday-ui-ratchet] refusing to raise a count:\n  ${violations.join('\n  ')}`);
      process.exit(1);
    }
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`[poolday-ui-ratchet] recorded ${JSON.stringify(current)}`);
  } else if (violations.length) {
    console.error(`[poolday-ui-ratchet] legacy UI grew:\n  ${violations.join('\n  ')}`);
    process.exit(1);
  } else {
    for (const note of lowered) console.log(`[poolday-ui-ratchet] lowered ${note}; run node scripts/verify-poolday-ui-ratchet.mjs --write`);
    console.log(`[poolday-ui-ratchet] OK ${JSON.stringify(current)}`);
  }
}
