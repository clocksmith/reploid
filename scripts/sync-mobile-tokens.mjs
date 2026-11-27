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

function parseMs(value, name) {
  const match = /^(\d+(?:\.\d+)?)ms$/.exec(value.trim());
  if (!match) {
    throw new Error(`Expected ms value for ${name}, got: ${value}`);
  }
  return Math.round(Number(match[1]));
}

function parseNumber(value, name) {
  const n = Number(value.trim());
  if (!Number.isFinite(n)) {
    throw new Error(`Expected numeric value for ${name}, got: ${value}`);
  }
  return n;
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

  const px = (name) => parsePx(requireToken(dark, name, 'dark'), name);
  const num = (name) => parseNumber(requireToken(dark, name, 'dark'), name);
  const ms = (name) => parseMs(requireToken(dark, name, 'dark'), name);
  const darkColor = (name) => parseColor(requireToken(dark, name, 'dark'), name);
  const lightColor = (name) => parseColor(requireToken(light, name, 'light'), name);

  const darkPage = darkColor('--pool-color-page');
  const darkLine = compositeOver(darkColor('--pool-color-line'), darkPage);
  const darkSecondary = extractGradientStop(
    requireToken(dark, '--pool-surface-primary', 'dark'),
    1,
    '--pool-surface-primary',
  );

  const lightPage = lightColor('--pool-color-page');
  const lightLine = compositeOver(lightColor('--pool-color-line'), lightPage);

  return `// GENERATED CODE - DO NOT MODIFY BY HAND.
// Source: apps/poolday/styles/poolday/tokens.css
// Generator: node scripts/sync-mobile-tokens.mjs

import 'package:flutter/material.dart' show Color;

abstract final class PooldayTokens {
  // Space and size
  static const double spacingGap = ${px('--pool-size-16')};
  static const double spacingInset = ${px('--pool-size-16')};
  static const double contentWidth = ${px('--pool-size-720')};

  // Shape and borders
  static const double radiusXs = ${px('--pool-radius-xs')};
  static const double controlRadius = ${px('--pool-radius-control')};
  static const double panelRadius = ${px('--pool-radius-panel')};
  static const double pillRadius = ${px('--pool-radius-pill')};
  static const double borderThin = ${px('--pool-border-thin')};
  static const double borderThick = ${px('--pool-border-thick')};

  // Type scale and line heights
  static const double textXs = ${px('--pool-text-xs')};
  static const double textSm = ${px('--pool-text-sm')};
  static const double textLg = ${px('--pool-text-lg')};
  static const double textXl = ${px('--pool-text-xl')};
  static const double textDisplay = ${px('--pool-text-display')};
  static const double leadingTight = ${num('--pool-leading-tight')};
  static const double leadingSnug = ${num('--pool-leading-snug')};
  static const double leadingRead = ${num('--pool-leading-read')};

  // Motion
  static const int durationFastMs = ${ms('--pool-duration-fast')};
  static const int durationBaseMs = ${ms('--pool-duration-base')};
}

abstract final class PooldayDarkTokens {
  static const page = ${toDartColor(darkPage)};
  static const raised = ${toDartColor(darkColor('--pool-color-raised'))};
  static const inset = ${toDartColor(darkColor('--pool-color-inset'))};
  static const line = ${toDartColor(darkLine)};
  static const ink = ${toDartColor(darkColor('--pool-color-ink'))};
  static const muted = ${toDartColor(darkColor('--pool-color-muted'))};
  static const focus = ${toDartColor(darkColor('--pool-color-focus'))};
  static const onPrimary = ${toDartColor(darkColor('--pool-color-on-primary'))};
  static const secondary = ${toDartColor(darkSecondary)};
  static const statusReady = ${toDartColor(darkColor('--pool-color-status-ready'))};
  static const statusPending = ${toDartColor(darkColor('--pool-color-status-pending'))};
  static const statusError = ${toDartColor(darkColor('--pool-color-status-error'))};
}

abstract final class PooldayLightTokens {
  static const page = ${toDartColor(lightPage)};
  static const raised = ${toDartColor(lightColor('--pool-color-raised'))};
  static const inset = ${toDartColor(lightColor('--pool-color-inset'))};
  static const line = ${toDartColor(lightLine)};
  static const ink = ${toDartColor(lightColor('--pool-color-ink'))};
  static const muted = ${toDartColor(lightColor('--pool-color-muted'))};
  static const focus = ${toDartColor(lightColor('--pool-color-focus'))};
  static const statusReady = ${toDartColor(lightColor('--pool-color-status-ready'))};
  static const statusPending = ${toDartColor(lightColor('--pool-color-status-pending'))};
  static const statusError = ${toDartColor(lightColor('--pool-color-status-error'))};
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
