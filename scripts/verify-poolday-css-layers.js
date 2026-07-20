#!/usr/bin/env node
/**
 * Verifies the Poolday design-system layering contract:
 *   tokens -> primitives -> components
 *
 * - styles/poolday/tokens.css      raw values only; may alias rd base tokens;
 *                                  never references primitive-category names.
 * - styles/poolday/primitives.css  semantic vars consuming only token-category
 *                                  vars or rd tokens; alpha composition via
 *                                  rgb(var(--pool-color-*-rgb) / N%) is legal;
 *                                  @keyframes bodies are exempt.
 * - styles/poolday/components.css  pool-* rules consuming only primitive vars;
 *                                  no color literals, no token-category vars,
 *                                  no bare rd tokens.
 *
 * Exemptions (documented in components.css header): media-query conditions,
 * @keyframes internals, transform/clip-path/grid-track numerics, percentages,
 * 0/auto/1fr, and the JS-contract vars set at runtime by pool-home scripts.
 *
 * Usage: node scripts/verify-poolday-css-layers.js [--warn]
 *   --warn  report violations but exit 0 (used during migration)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = path.join(ROOT, 'self', 'styles');
const WARN_ONLY = process.argv.includes('--warn');

const TOKEN_CATEGORY = /^--pool-(color|gradient|dim|size|motion-duration|motion-easing|font)(-|$)/;
const PRIMITIVE_CATEGORY = /^--pool-(surface|frame|border|space|px|radius|z|transition|motion|text|type|opacity|metric|hue|tint)(-|$)/;
const JS_CONTRACT_VARS = new Set(['--tooltip-x', '--tooltip-y', '--pool-label-x', '--pool-label-y']);
/* Component parameter vars: set by component rules (incl. media overrides),
   consumed by descendants. Values obey component-layer rules. */
const PARAMETER_VAR = /^--pool-param-[\w-]+$/;
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|hsl)\(\s*\d/;
const LENGTH_LITERAL = /(?<![\w.-])(?!0(?![.\d]))[\d.]+(?:px|rem|em|ms|s)\b/;
const LENGTH_EXEMPT_PROPERTIES = new Set([
  'transform', 'translate', 'rotate', 'scale', 'clip-path',
  'grid-template-columns', 'grid-template-rows', 'grid-auto-rows',
  'background-position', 'background-size', 'stroke-dasharray', 'stroke-width'
]);

const isTokenName = (name) => TOKEN_CATEGORY.test(name);
const isPrimitiveName = (name) => !isTokenName(name) && PRIMITIVE_CATEGORY.test(name);

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

const readLayer = (file) => {
  const text = readFileSync(path.join(STYLES, 'poolday', file), 'utf8');
  return { file: `styles/poolday/${file}`, text, clean: stripComments(text) };
};

/** Walk declarations with selector + at-rule context. */
const walkDeclarations = (clean, visit) => {
  const contextStack = [];
  let buffer = '';
  let line = 1;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === '\n') line += 1;
    if (ch === '{') {
      contextStack.push(buffer.trim());
      buffer = '';
    } else if (ch === '}') {
      contextStack.pop();
      buffer = '';
    } else if (ch === ';') {
      const declaration = buffer.trim();
      buffer = '';
      const colon = declaration.indexOf(':');
      if (colon > 0 && contextStack.length > 0) {
        const property = declaration.slice(0, colon).trim();
        const value = declaration.slice(colon + 1).trim();
        visit({ property, value, line, context: [...contextStack] });
      }
    } else {
      buffer += ch;
    }
  }
};

const inKeyframes = (context) => context.some((c) => c.startsWith('@keyframes'));

const rdTokenAllowlist = () => {
  const rd = stripComments(readFileSync(path.join(STYLES, 'rd.css'), 'utf8'));
  const names = new Set();
  for (const match of rd.matchAll(/(--[a-z][\w-]*)\s*:/g)) names.add(match[1]);
  return names;
};

const violations = [];
const report = (layer, line, message) => violations.push(`${layer}:${line} ${message}`);

const varRefs = (value) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

const main = () => {
  const rdTokens = rdTokenAllowlist();
  const tokens = readLayer('tokens.css');
  const primitives = readLayer('primitives.css');
  const components = readLayer('components.css');

  walkDeclarations(tokens.clean, ({ property, value, line, context }) => {
    if (context[0] !== '.pool-home') {
      report(tokens.file, line, `declaration outside .pool-home token block (${context.join(' > ')})`);
    }
    if (!property.startsWith('--')) {
      report(tokens.file, line, `non-custom-property rule in token layer: ${property}`);
      return;
    }
    if (!isTokenName(property)) {
      report(tokens.file, line, `token name outside token categories: ${property}`);
    }
    for (const ref of varRefs(value)) {
      if (ref.startsWith('--pool-') && !isTokenName(ref)) {
        report(tokens.file, line, `token ${property} references non-token pool var ${ref}`);
      } else if (!ref.startsWith('--pool-') && !rdTokens.has(ref)) {
        report(tokens.file, line, `token ${property} references unknown var ${ref}`);
      }
    }
  });

  walkDeclarations(primitives.clean, ({ property, value, line, context }) => {
    if (inKeyframes(context)) return;
    if (!property.startsWith('--')) {
      if (context[0] !== '.pool-home') {
        report(primitives.file, line, `style rule in primitive layer: ${context.join(' > ')} { ${property} }`);
      }
      return;
    }
    if (!isPrimitiveName(property)) {
      report(primitives.file, line, `primitive name outside primitive categories: ${property}`);
    }
    if (COLOR_LITERAL.test(value)) {
      report(primitives.file, line, `color literal in primitive ${property}: ${value}`);
    }
    for (const ref of varRefs(value)) {
      if (ref.startsWith('--pool-') && !isTokenName(ref)) {
        report(primitives.file, line, `primitive ${property} references non-token pool var ${ref}`);
      } else if (!ref.startsWith('--pool-') && !rdTokens.has(ref)) {
        report(primitives.file, line, `primitive ${property} references unknown var ${ref}`);
      }
    }
  });

  walkDeclarations(components.clean, ({ property, value, line, context }) => {
    if (inKeyframes(context)) return;
    if (property.startsWith('--') && !JS_CONTRACT_VARS.has(property) && !PARAMETER_VAR.test(property)) {
      report(components.file, line, `custom property defined in component layer: ${property}`);
    }
    if (COLOR_LITERAL.test(value)) {
      report(components.file, line, `color literal in component rule (${property}): ${value}`);
    }
    for (const ref of varRefs(value)) {
      if (JS_CONTRACT_VARS.has(ref) || PARAMETER_VAR.test(ref)) continue;
      if (ref.startsWith('--pool-')) {
        if (!isPrimitiveName(ref)) {
          report(components.file, line, `component consumes non-primitive pool var ${ref} (${property})`);
        }
      } else {
        report(components.file, line, `component consumes non-pool var ${ref} directly (${property})`);
      }
    }
    if (!LENGTH_EXEMPT_PROPERTIES.has(property) && !property.startsWith('--')) {
      const withoutVars = value.replace(/var\([^)]*\)/g, '');
      const hit = withoutVars.match(LENGTH_LITERAL);
      if (hit) {
        report(components.file, line, `raw length literal '${hit[0]}' in component rule (${property}: ${value})`);
      }
    }
  });

  /* Existence check: every --pool-* reference must be defined in some layer.
     Category checks alone cannot catch a well-named but undefined var. */
  const definedPool = new Set();
  for (const layer of [tokens, primitives, components]) {
    for (const match of layer.clean.matchAll(/(--pool-[\w-]+)\s*:/g)) definedPool.add(match[1]);
  }
  for (const layer of [primitives, components]) {
    const lines = layer.clean.split('\n');
    lines.forEach((text, index) => {
      for (const match of text.matchAll(/var\(\s*(--pool-[\w-]+)/g)) {
        const ref = match[1];
        if (!definedPool.has(ref) && !JS_CONTRACT_VARS.has(ref)) {
          report(layer.file, index + 1, `reference to undefined pool var ${ref}`);
        }
      }
    });
  }

  if (violations.length === 0) {
    console.log('[poolday-css-layers] OK: layering contract holds across tokens/primitives/components');
    return 0;
  }
  console.error(`[poolday-css-layers] ${violations.length} violation(s):`);
  for (const violation of violations) console.error(`  ${violation}`);
  return WARN_ONLY ? 0 : 1;
};

process.exit(main());
