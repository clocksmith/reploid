#!/usr/bin/env node
/**
 * Generate Dart design tokens for apps/mobile from apps/poolday/styles/poolday/tokens.css.
 *
 * Usage:
 *   node scripts/sync-mobile-tokens.mjs          # write apps/mobile/app/lib/design_system/poolday_tokens.g.dart
 *   node scripts/sync-mobile-tokens.mjs --check  # fail with exit code 1 if the generated file has drifted
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_CSS = path.join(root, 'apps/poolday/styles/poolday/tokens.css');
const TARGET_DART = path.join(root, 'apps/mobile/app/lib/design_system/poolday_tokens.g.dart');

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractBlock(css, selectorPattern) {
  const match = selectorPattern.exec(css);
  if (!match) {
    throw new Error(`Could not find selector block matching ${selectorPattern} in tokens.css`);
  }
  const start = match.index + match[0].length;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  const body = css.slice(start, i - 1);
  const tokens = new Map();
  for (const decl of body.split(';')) {
    const trimmed = decl.trim();
    if (!trimmed.startsWith('--')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const name = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    tokens.set(name, value);
  }
  return tokens;
}

function requireToken(map, name, label) {
  const value = map.get(name);
  if (value == null) {
    throw new Error(`Missing required token ${name} in ${label} block of tokens.css`);
  }
  return value;
}

function parsePx(value, name) {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (!match) {
    throw new Error(`Expected px value for ${name}, got: ${value}`);
  }
  return Number(match[1]);
}

function parseColor(value, name) {
  const trimmed = value.trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 };
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*(\d+(?:\.\d+)?)%)?\s*\)$/.exec(trimmed);
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] == null ? 1 : Number(rgb[4]) / 100,
    };
  }
  throw new Error(`Unsupported color syntax for ${name}: ${value}`);
}

function extractGradientStop(value, index, name) {
  const hexes = [...value.matchAll(/#([0-9a-fA-F]{6})/g)].map((m) => `#${m[1]}`);
  if (hexes.length <= index) {
    throw new Error(`Expected at least ${index + 1} hex stops in ${name}, got: ${value}`);
  }
  return parseColor(hexes[index], `${name}[${index}]`);
}

function compositeOver(fg, bg) {
  const a = fg.a;
  return {
    r: Math.round(bg.r + a * (fg.r - bg.r)),
    g: Math.round(bg.g + a * (fg.g - bg.g)),
    b: Math.round(bg.b + a * (fg.b - bg.b)),
    a: 1,
  };
}

function toDartColor(c) {
  const hex = [c.r, c.g, c.b]
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
    .join('');
  return `Color(0xff${hex})`;
}

export function generateDartTokens(cssText) {
  const clean = stripComments(cssText);
  const dark = extractBlock(clean, /:root\.pool-page,\s*\.pool-home\s*\{/);
  const light = extractBlock(
    clean,
    /:root\.pool-page\[data-reploid-theme='light'\],\s*\.pool-home\[data-pool-theme='light'\]\s*\{/,
  );

  const spacingGap = parsePx(requireToken(dark, '--pool-size-16', 'dark'), '--pool-size-16');
  const contentWidth = parsePx(requireToken(dark, '--pool-size-720', 'dark'), '--pool-size-720');
  const controlRadius = parsePx(
    requireToken(dark, '--pool-radius-control', 'dark'),
    '--pool-radius-control',
  );
  const panelRadius = parsePx(
    requireToken(dark, '--pool-radius-panel', 'dark'),
    '--pool-radius-panel',
  );

  const darkPage = parseColor(requireToken(dark, '--pool-color-page', 'dark'), '--pool-color-page');
  const darkRaised = parseColor(
    requireToken(dark, '--pool-color-raised', 'dark'),
    '--pool-color-raised',
  );
  const darkInset = parseColor(
    requireToken(dark, '--pool-color-inset', 'dark'),
    '--pool-color-inset',
  );
  const darkLine = compositeOver(
    parseColor(requireToken(dark, '--pool-color-line', 'dark'), '--pool-color-line'),
    darkPage,
  );
  const darkInk = parseColor(requireToken(dark, '--pool-color-ink', 'dark'), '--pool-color-ink');
  const darkMuted = parseColor(
    requireToken(dark, '--pool-color-muted', 'dark'),
    '--pool-color-muted',
  );
  const darkFocus = parseColor(
    requireToken(dark, '--pool-color-focus', 'dark'),
    '--pool-color-focus',
  );
  const darkOnPrimary = parseColor(
    requireToken(dark, '--pool-color-on-primary', 'dark'),
    '--pool-color-on-primary',
  );
  const darkSecondary = extractGradientStop(
    requireToken(dark, '--pool-surface-primary', 'dark'),
    1,
    '--pool-surface-primary',
  );
  const darkStatusReady = parseColor(
    requireToken(dark, '--pool-color-status-ready', 'dark'),
    '--pool-color-status-ready',
  );
  const darkStatusPending = parseColor(
    requireToken(dark, '--pool-color-status-pending', 'dark'),
    '--pool-color-status-pending',
  );
  const darkStatusError = parseColor(
    requireToken(dark, '--pool-color-status-error', 'dark'),
    '--pool-color-status-error',
  );

  const lightPage = parseColor(
    requireToken(light, '--pool-color-page', 'light'),
    '--pool-color-page',
  );
  const lightRaised = parseColor(
    requireToken(light, '--pool-color-raised', 'light'),
    '--pool-color-raised',
  );
  const lightInset = parseColor(
    requireToken(light, '--pool-color-inset', 'light'),
    '--pool-color-inset',
  );
  const lightLine = compositeOver(
    parseColor(requireToken(light, '--pool-color-line', 'light'), '--pool-color-line'),
    lightPage,
  );
  const lightInk = parseColor(requireToken(light, '--pool-color-ink', 'light'), '--pool-color-ink');
  const lightMuted = parseColor(
    requireToken(light, '--pool-color-muted', 'light'),
    '--pool-color-muted',
  );
  const lightFocus = parseColor(
    requireToken(light, '--pool-color-focus', 'light'),
    '--pool-color-focus',
  );
  const lightStatusReady = parseColor(
    requireToken(light, '--pool-color-status-ready', 'light'),
    '--pool-color-status-ready',
  );
  const lightStatusPending = parseColor(
    requireToken(light, '--pool-color-status-pending', 'light'),
    '--pool-color-status-pending',
  );
  const lightStatusError = parseColor(
    requireToken(light, '--pool-color-status-error', 'light'),
    '--pool-color-status-error',
  );

  return `// GENERATED CODE - DO NOT MODIFY BY HAND.
// Source: apps/poolday/styles/poolday/tokens.css
// Generator: node scripts/sync-mobile-tokens.mjs

import 'package:flutter/material.dart' show Color;

abstract final class PooldayTokens {
  static const double spacingGap = ${spacingGap};
  static const double spacingInset = ${spacingGap};
  static const double contentWidth = ${contentWidth};
  static const double controlRadius = ${controlRadius};
  static const double panelRadius = ${panelRadius};
}

abstract final class PooldayDarkTokens {
  static const page = ${toDartColor(darkPage)};
  static const raised = ${toDartColor(darkRaised)};
  static const inset = ${toDartColor(darkInset)};
  static const line = ${toDartColor(darkLine)};
  static const ink = ${toDartColor(darkInk)};
  static const muted = ${toDartColor(darkMuted)};
  static const focus = ${toDartColor(darkFocus)};
  static const onPrimary = ${toDartColor(darkOnPrimary)};
  static const secondary = ${toDartColor(darkSecondary)};
  static const statusReady = ${toDartColor(darkStatusReady)};
  static const statusPending = ${toDartColor(darkStatusPending)};
  static const statusError = ${toDartColor(darkStatusError)};
}

abstract final class PooldayLightTokens {
  static const page = ${toDartColor(lightPage)};
  static const raised = ${toDartColor(lightRaised)};
  static const inset = ${toDartColor(lightInset)};
  static const line = ${toDartColor(lightLine)};
  static const ink = ${toDartColor(lightInk)};
  static const muted = ${toDartColor(lightMuted)};
  static const focus = ${toDartColor(lightFocus)};
  static const statusReady = ${toDartColor(lightStatusReady)};
  static const statusPending = ${toDartColor(lightStatusPending)};
  static const statusError = ${toDartColor(lightStatusError)};
}
`;
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  if (args.some((arg) => arg !== '--check' && arg !== '--write')) {
    throw new Error('Usage: node scripts/sync-mobile-tokens.mjs [--check | --write]');
  }

  const cssText = fs.readFileSync(SOURCE_CSS, 'utf8');
  const expected = generateDartTokens(cssText);

  if (checkOnly) {
    const actual = fs.existsSync(TARGET_DART) ? fs.readFileSync(TARGET_DART, 'utf8') : null;
    if (actual !== expected) {
      console.error(
        'Mobile design tokens have drifted from apps/poolday/styles/poolday/tokens.css.\n' +
          'Run: npm run sync:mobile-tokens',
      );
      process.exit(1);
    }
    return;
  }

  fs.writeFileSync(TARGET_DART, expected, 'utf8');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
