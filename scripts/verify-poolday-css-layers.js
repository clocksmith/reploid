#!/usr/bin/env node
/**
 * Verifies the Poolday design-system layering contract:
 *   tokens -> primitives -> compositions
 *
 * - tokens.css          every Poolday custom property: small scales and semantic values
 *                        mapped per theme. Tokens reference only tokens.
 * - primitives/*.css     classes that are the building blocks (surface, card, button,
 *                        input, stack, row, columns, text styles...). Only primitives
 *                        read tokens; they also read parameters (--pool-param-*) and
 *                        runtime inputs.
 * - compositions/*.css   screens arranged from primitives. A composition reads no token
 *                        and sets no visual property (color, background, border, shadow,
 *                        radius, type, opacity, filter): spacing and looks come from
 *                        primitive classes in the markup. Files under "legacyTokenReferences"
 *                        and "legacy" in layers.json may only lower those counts.
 * - Composition scripts (the React app outside its design page, and the vanilla UI) name
 *   no token either; under "legacyScriptTokenReferences" the vanilla count may only fall.
 * - Keyframes are looks and live in primitives; compositions reference them by name only.
 * - A primitive does not style composition markup through :where() aliases: the markup
 *   carries the primitive class instead (only the .pool-home scope and the .btn alias remain).
 * - Literals in primitives and compositions are structural only: 0, 1, grid/flex
 *   counts and fr, calc multipliers, and percentages or viewport units in geometry.
 * - pool-entry.html loads only the Poolday layers. index.html can host Poolday
 *   routes, so every stylesheet it links excludes .pool-home from each selector.
 * - Product UI scripts write only custom properties to inline styles.
 *
 * Media-query conditions are exempt: custom properties cannot appear there.
 *
 * Usage: node scripts/verify-poolday-css-layers.js [--warn]
 *   --warn  report violations but exit 0 (used during migration)
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveServedFile } from '../server/browser-roots.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The Poolday stylesheets live wherever the served tree's styles/poolday/ is.
const STYLES = path.dirname(path.dirname(resolveServedFile('styles/poolday/layers.json')));
const WARN_ONLY = process.argv.includes('--warn');

const JS_CONTRACT_VARS = new Set(['--tooltip-x', '--tooltip-y', '--pool-label-x', '--pool-label-y',
  '--pool-param-share', '--pool-param-composer-height', '--pool-param-capability-score']);
/* Component parameter vars: set by component rules (incl. media overrides),
   consumed by descendants. Values obey component-layer rules. */
const PARAMETER_VAR = /^--pool-param-[\w-]+$/;
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|%23[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|hsl|oklch|oklab|lab|lch)\(\s*\d/;
const NAMED_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown '
  + 'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray '
  + 'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue '
  + 'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite '
  + 'forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory '
  + 'khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen '
  + 'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime '
  + 'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue '
  + 'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive '
  + 'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum '
  + 'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue '
  + 'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke '
  + 'yellow yellowgreen').split(' '));
const SYSTEM_COLORS = new Set(('accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field '
  + 'fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext').split(' '));
/* Named and system colors in a value, ignoring var() names, strings and url() payloads.
   System colors are legitimate only where forced colors replace the palette. */
const namedColors = (value, context) => {
  const bare = value.replace(/var\([^)]*\)/g, ' ').replace(/url\([^)]*\)/g, ' ').replace(/(["'])(?:\\.|(?!\1).)*\1/g, ' ');
  const forced = context.some((c) => /forced-colors\s*:\s*active/.test(c));
  return [...bare.matchAll(/(?<![\w-])([a-zA-Z]+)(?![\w-])/g)].map((m) => m[1].toLowerCase())
    .filter((word) => NAMED_COLORS.has(word) || (SYSTEM_COLORS.has(word) && !forced));
};
const POOL_EXCLUSION = ':where(:not(.pool-home, .pool-home *))';
const PRIMITIVE_ALIASES = new Set(['pool-home', 'btn']);

/* Literal policy. Lengths, durations, colours and type values come from tokens. A value that
   belongs to one primitive is written there: unitless numbers (stacking order, scale, counts,
   dash lengths), angles, and percentages outside opacity and colour mixing. */
const TYPE_PROPERTIES = new Set(['font-size', 'font-weight', 'line-height', 'letter-spacing', 'font', 'word-spacing']);
const STRUCTURAL_PROPERTIES = new Set(['grid-column', 'grid-row', 'grid-area', 'grid-column-start', 'grid-column-end',
  'grid-row-start', 'grid-row-end', 'order', 'flex', 'flex-grow', 'flex-shrink', 'aspect-ratio', 'grid-template-columns',
  'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows', 'animation-iteration-count', '-webkit-line-clamp',
  'line-clamp', 'column-count', 'columns']);
const GEOMETRY_PROPERTIES = new Set(['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'inline-size',
  'block-size', 'min-inline-size', 'max-inline-size', 'min-block-size', 'max-block-size', 'top', 'right', 'bottom', 'left',
  'inset', 'inset-inline', 'inset-block', 'inset-inline-start', 'inset-inline-end', 'inset-block-start', 'inset-block-end',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-inline', 'margin-block',
  'margin-inline-start', 'margin-inline-end', 'margin-block-start', 'margin-block-end', 'padding', 'padding-top',
  'padding-right', 'padding-bottom', 'padding-left', 'padding-inline', 'padding-block', 'padding-inline-start',
  'padding-inline-end', 'padding-block-start', 'padding-block-end', 'gap', 'row-gap', 'column-gap', 'translate',
  'transform', 'transform-origin', 'flex', 'flex-basis', 'background-size', 'background-position', 'background-position-x',
  'background-position-y', 'mask-size', 'mask-position', '-webkit-mask-size', '-webkit-mask-position', 'clip-path',
  'object-position', 'grid-template-columns', 'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows']);
const VIEWPORT_UNITS = new Set(['vw', 'vh', 'dvh', 'svh', 'lvh', 'dvw', 'svw', 'lvw', 'vmin', 'vmax']);
const NUMERIC_LITERAL = /(?<![\w.#-])(-?(?:\d*\.\d+|\d+))(%|[a-zA-Z]+)?(?![\w.])/g;
const opaqueValue = (value) => {
  let bare = value, previous;
  do { previous = bare; bare = bare.replace(/var\(\s*--[\w-]+\s*(?:,[^()]*)?\)/g, ' '); } while (bare !== previous);
  return bare.replace(/url\([^)]*\)/g, ' ').replace(/(["'])(?:\\.|(?!\1).)*\1/g, ' ');
};
const ANGLE_UNITS = new Set(['deg', 'turn', 'rad', 'grad']);
const allowedLiteral = (property, number, unit, multiplier, value) => {
  if (number === 0) return true;
  if (unit === '') {
    if (multiplier || STRUCTURAL_PROPERTIES.has(property)) return true;
    return !TYPE_PROPERTIES.has(property) && (property !== 'opacity' || number === 1);
  }
  if (unit === 'fr') return /^grid-(template|auto)-/.test(property);
  if (ANGLE_UNITS.has(unit)) return true;
  if (unit === '%') return property !== 'opacity' && !/color-mix\(/.test(value);
  if (VIEWPORT_UNITS.has(unit)) return GEOMETRY_PROPERTIES.has(property) || PARAMETER_VAR.test(property);
  return false;
};
const literalViolations = (property, value) => {
  const bare = opaqueValue(value);
  return [...bare.matchAll(NUMERIC_LITERAL)].filter((match) => {
    const before = bare.slice(0, match.index).trimEnd().slice(-1);
    const after = bare.slice(match.index + match[0].length).trimStart()[0];
    const multiplier = before === '*' || before === '/' || after === '*';
    return !allowedLiteral(property, Number(match[1]), (match[2] || '').toLowerCase(), multiplier, value);
  }).map((match) => match[0]);
};


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

/* Split a selector list on top-level commas. */
const splitSelectors = (text) => {
  const parts = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
};

/* Every style rule in a non-Poolday stylesheet must exclude the Poolday subtree. */
const checkIsolated = (file) => {
  const clean = stripComments(readFileSync(resolveServedFile(file), 'utf8'));
  const stack = []; let buffer = '', line = 1;
  for (const ch of clean) {
    if (ch === '\n') line += 1;
    if (ch === '{') {
      const prelude = buffer.trim(); buffer = '';
      const inKeyframes = stack.some((entry) => /^@(-[a-z]+-)?keyframes/.test(entry));
      if (prelude && !prelude.startsWith('@') && !inKeyframes) {
        for (const selector of splitSelectors(prelude)) {
          if (!selector.includes(POOL_EXCLUSION)) report(file, line, `selector can style Poolday markup: ${selector}`);
        }
      }
      stack.push(prelude);
    } else if (ch === '}') { stack.pop(); buffer = ''; }
    else if (ch === ';') buffer = '';
    else buffer += ch;
  }
};

/* Tokens attach to every .pool-home and to the Poolday page root, with a light-theme block. */
const TOKEN_BLOCKS = new Set([':root.pool-page, .pool-home', ":root.pool-page[data-reploid-theme='light'], .pool-home[data-pool-theme='light']"]);
/* In a converted composition these come from primitive classes in the markup. */
const VISUAL_PROPERTY = /^(color|background(-color|-image)?|border(-(top|bottom|left|right|block|inline))?(-color|-style)?|border-radius|box-shadow|font(-size|-weight|-family)?|line-height|letter-spacing|text-transform|opacity|filter|backdrop-filter|-webkit-backdrop-filter|outline(-color)?|text-decoration|text-shadow|mask-image|-webkit-mask-image)$/;

/* Product UI scripts, and the shared components they import, may write only custom
   properties inline; component rules decide how those values render. */
const checkInlineStyles = () => {
  const uiDir = path.dirname(resolveServedFile('ui/pool-home/index.js'));
  const files = readdirSync(uiDir).filter((file) => file.endsWith('.js')).map((file) => path.join(uiDir, file));
  const shared = new Set();
  for (const file of files) {
    // Components resolve through the served tree, whichever root holds them.
    for (const match of readFileSync(file, 'utf8').matchAll(/from ['"](?:\.\.\/)+(?:[\w/]+\/)?(ui\/components\/[\w-]+\.js|components\/[\w-]+\.js)['"]/g)) {
      shared.add(resolveServedFile(match[1].startsWith('ui/') ? match[1] : 'ui/' + match[1]));
    }
  }
  for (const file of [...files, ...shared]) {
    const relative = path.relative(ROOT, file);
    readFileSync(file, 'utf8').split('\n').forEach((text, index) => {
      for (const match of text.matchAll(/\bstyle=\\?["']([^"']*)["']/g)) {
        const declarations = match[1].split(';').map((part) => part.trim()).filter(Boolean);
        if (declarations.some((declaration) => !declaration.startsWith('--'))) report(relative, index + 1, `inline style sets a property directly: ${match[0]}`);
      }
      for (const match of text.matchAll(/\.style\.(?!setProperty\b|removeProperty\b|getPropertyValue\b)([a-zA-Z]+)\s*=(?!=)/g)) {
        report(relative, index + 1, `script writes style.${match[1]}; set a --pool-param-* the component consumes`);
      }
      for (const match of text.matchAll(/\.style\.setProperty\(\s*['"`](?!--)([^'"`]+)/g)) {
        report(relative, index + 1, `script sets style property ${match[1]}; set a --pool-param-* the component consumes`);
      }
      if (/\.style\.cssText\s*=|\.style\[[^\]]+\]\s*=(?!=)|setAttribute\(\s*['"]style['"]/.test(text)) {
        report(relative, index + 1, 'script writes inline style text');
      }
    });
  }
};

/* Composition scripts name no token: the React app outside its design page (which documents the
   tokens) and the vanilla UI outside its shared components. Vanilla files under
   "legacyScriptTokenReferences" may only lower their count. */
const SCRIPT_SOURCES = [
  { dir: 'apps/poolday-react/src', skip: /\/features\/design\/|\.generated\./ },
  { dir: 'apps/poolday/ui', skip: /\/react\/|\/components\/|\.bundle\.js$/ },
];
const listScripts = (dir) => readdirSync(path.join(ROOT, dir), { recursive: true })
  .filter((file) => /\.(js|mjs|ts|tsx)$/.test(file)).map((file) => path.join(dir, file));
const checkScriptTokens = (manifest, tokenNames) => {
  const legacy = manifest.legacyScriptTokenReferences ?? {};
  for (const { dir, skip } of SCRIPT_SOURCES) {
    for (const file of listScripts(dir)) {
      if (skip.test(`/${file}`)) continue;
      let count = 0, first = 0;
      readFileSync(path.join(ROOT, file), 'utf8').split('\n').forEach((text, index) => {
        for (const [name] of text.matchAll(/--pool-[a-z0-9-]+/g)) {
          if (!tokenNames.has(name)) continue;
          count += 1;
          first ||= index + 1;
        }
      });
      const allowed = legacy[file] ?? 0;
      if (count > allowed) report(file, first, `${count} token reference(s) in a composition script${allowed ? ` exceed the ${allowed} left to convert` : ''}; use a primitive or a --pool-param-*`);
      if (count < allowed) console.log(`[poolday-css-layers] ${file}: ${count} token references left (lower "legacyScriptTokenReferences" in layers.json to ${count})`);
    }
  }
};

const violations = [];
const report = (layer, line, message) => violations.push(`${layer}:${line} ${message}`);

const varRefs = (value) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

const main = () => {
  const manifest = JSON.parse(readFileSync(path.join(STYLES, 'poolday/layers.json'), 'utf8'));
  const files = [manifest.tokens, ...manifest.primitives, ...manifest.compositions];
  if (new Set(files).size !== files.length || files.some(file => !/^[a-z][a-z/-]*\.css$/.test(file))) {
    throw new Error('Poolday layer manifest must contain unique local CSS paths');
  }
  const discovered = readdirSync(path.join(STYLES, 'poolday'), { recursive: true })
    .filter(file => file.endsWith('.css')).sort();
  if (JSON.stringify(discovered) !== JSON.stringify([...files].sort())) {
    report('layers.json', 1, 'every Poolday stylesheet must belong to exactly one layer');
  }
  const entry = readFileSync(resolveServedFile('pool-entry.html'), 'utf8');
  const linked = [...entry.matchAll(/href=["']\/styles\/poolday\/([^"'?]+)(?:\?[^"']*)?["']/g)].map(match => match[1]);
  const fallback = readFileSync(resolveServedFile('index.html'), 'utf8');
  const fallbackFiles = JSON.parse(fallback.match(/const pooldayStylesheets = (\[[^;]+\]);/)?.[1] || '[]');
  for (const [name, actual] of [['pool-entry.html', linked], ['index.html', fallbackFiles]]) {
    if (JSON.stringify(actual) !== JSON.stringify(files)) report(name, 1, 'stylesheet load order differs from layers.json');
  }
  const stylesheets = (html) => [...html.matchAll(/href=["']\/(styles\/[^"'?]+\.css)(?:\?[^"']*)?["']/g)].map(match => match[1])
    .filter(file => !file.startsWith('styles/poolday/'));
  for (const file of stylesheets(entry)) report('pool-entry.html', 1, `the Poolday entry loads a stylesheet outside the layers: ${file}`);
  if (!/<html[^>]*\bclass=["'][^"']*\bpool-page\b/.test(entry)) report('pool-entry.html', 1, 'the page root must carry class="pool-page"');
  for (const file of stylesheets(fallback)) checkIsolated(file);
  checkInlineStyles();

  // Tokens: every Poolday custom property, in the root or light-theme block, referencing only tokens.
  const tokens = readLayer(manifest.tokens);
  const tokenNames = new Set();
  walkDeclarations(tokens.clean, ({ property, line, context }) => {
    const blocks = context.filter((entry) => !entry.startsWith('@media')).map((entry) => entry.replace(/\s+/g, ' '));
    if (blocks.length !== 1 || !TOKEN_BLOCKS.has(blocks[0])) report(tokens.file, line, `declaration outside the token blocks (${context.join(' > ')})`);
    if (!property.startsWith('--pool-') || PARAMETER_VAR.test(property)) report(tokens.file, line, `${property} is not a token`);
    else tokenNames.add(property);
  });
  walkDeclarations(tokens.clean, ({ property, value, line }) => {
    for (const ref of varRefs(value)) if (!tokenNames.has(ref)) report(tokens.file, line, `token ${property} references ${ref}, which is not a token`);
  });

  checkScriptTokens(manifest, tokenNames);

  // Primitives and compositions consume tokens, parameters and runtime inputs, with structural literals only.
  // A converted composition only arranges: its look comes from primitive classes in the markup.
  // A legacy composition may not grow its remaining visual declarations.
  const legacy = manifest.legacy ?? {};
  const legacyTokens = manifest.legacyTokenReferences ?? {};
  for (const file of [...manifest.primitives, ...manifest.compositions]) {
    const layer = readLayer(file);
    const converted = manifest.compositions.includes(file) && !(file in legacy);
    let visuals = 0, tokenRefs = 0;
    const isComposition = manifest.compositions.includes(file);
    const seenKeyframes = new Set(), seenAliases = new Set();
    walkDeclarations(layer.clean, ({ property, value, line, context }) => {
      const keyframes = context.find((c) => /^@(-[a-z]+-)?keyframes/.test(c));
      if (isComposition && keyframes && !seenKeyframes.has(keyframes)) {
        seenKeyframes.add(keyframes);
        report(layer.file, line, `composition defines ${keyframes}; keyframes are looks and belong in a primitive`);
      }
      if (!isComposition) {
        for (const entry of context) {
          for (const [, name] of entry.matchAll(/:where\(\s*\.([\w-]+)/g)) {
            if (!PRIMITIVE_ALIASES.has(name) && !seenAliases.has(name)) {
              seenAliases.add(name);
              report(layer.file, line, `primitive styles .${name} through a :where() alias; put the primitive class in that markup`);
            }
          }
        }
      }
      if (property.startsWith('--') && !JS_CONTRACT_VARS.has(property) && !PARAMETER_VAR.test(property)) {
        report(layer.file, line, `custom property defined outside tokens: ${property}`);
      }
      if (COLOR_LITERAL.test(value) || namedColors(value, context).length) report(layer.file, line, `color literal (${property}): ${value}`);
      for (const ref of varRefs(value)) {
        if (!JS_CONTRACT_VARS.has(ref) && !PARAMETER_VAR.test(ref) && !tokenNames.has(ref)) report(layer.file, line, `${ref} is not a token (${property})`);
        if (isComposition && tokenNames.has(ref)) {
          tokenRefs += 1;
          if (!(file in legacyTokens)) report(layer.file, line, `composition reads token ${ref}; put a primitive class in the markup (${property})`);
        }
      }
      if (!property.startsWith('--') || PARAMETER_VAR.test(property)) {
        const literals = literalViolations(property, value);
        if (literals.length) report(layer.file, line, `literal ${literals.join(', ')}; use a token (${property}: ${value})`);
      }
      if (VISUAL_PROPERTY.test(property) && !inKeyframes(context)) {
        visuals += 1;
        if (converted) report(layer.file, line, `composition sets ${property}; take it from a primitive class in the markup`);
      }
    });
    if (file in legacy && visuals > legacy[file]) {
      report(layer.file, 1, `${visuals} visual declarations exceed the ${legacy[file]} left to convert; move looks to primitives instead`);
    }
    if (file in legacyTokens && tokenRefs > legacyTokens[file]) {
      report(layer.file, 1, `${tokenRefs} token references exceed the ${legacyTokens[file]} left to convert; use primitive classes instead`);
    }
    if (file in legacyTokens && tokenRefs < legacyTokens[file]) console.log(`[poolday-css-layers] ${file}: ${tokenRefs} token references left (lower "legacyTokenReferences" in layers.json to ${tokenRefs})`);
    if (file in legacy && visuals < legacy[file]) console.log(`[poolday-css-layers] ${file}: ${visuals} visual declarations left (lower "legacy" in layers.json to ${visuals})`);
  }

  if (violations.length === 0) {
    console.log('[poolday-css-layers] OK: tokens -> primitives -> compositions');
    return 0;
  }
  console.error(`[poolday-css-layers] ${violations.length} violation(s):`);
  for (const violation of violations) console.error(`  ${violation}`);
  return WARN_ONLY ? 0 : 1;
};

process.exit(main());
