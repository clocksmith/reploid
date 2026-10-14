#!/usr/bin/env node
/**
 * Verifies the Poolday design-system layering contract:
 *   tokens -> primitives -> components
 *
 * - styles/poolday/tokens.css      raw values; references only other tokens.
 * - styles/poolday/primitives.css  compositions of token vars only: no numeric
 *                                  literal other than 0, no color literal.
 * - styles/poolday/components*.css rules consuming only primitive vars, component
 *                                  parameters (--pool-param-*) and the runtime
 *                                  JS-contract vars. Colors, lengths, angles, times,
 *                                  weights, line heights, opacities, stacking,
 *                                  scales and easings come from primitives. The only
 *                                  literals left are structural: 0, 1, grid/flex
 *                                  counts and fr, calc multipliers, and percentages
 *                                  or viewport units in geometry properties.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = path.join(ROOT, 'self', 'styles');
const WARN_ONLY = process.argv.includes('--warn');

const TOKEN_CATEGORY = /^--pool-(color|gradient|dim|size|motion-duration|motion-easing|font|layer|alpha|ratio)(-|$)/;
const PRIMITIVE_CATEGORY = /^--pool-(surface|frame|border|space|px|radius|z|transition|motion|text|type|opacity|metric|hue|tint|angle|scale)(-|$)/;
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

/* Literal policy for component values. Everything a designer tunes is a primitive;
   what remains is structure. */
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
const allowedLiteral = (property, number, unit, multiplier) => {
  if (number === 0) return true;
  if (unit === '') {
    if (multiplier || STRUCTURAL_PROPERTIES.has(property)) return true;
    return number === 1 && !TYPE_PROPERTIES.has(property) && property !== 'z-index';
  }
  if (unit === 'fr') return /^grid-(template|auto)-/.test(property);
  if (unit === '%' || VIEWPORT_UNITS.has(unit)) return GEOMETRY_PROPERTIES.has(property) || PARAMETER_VAR.test(property);
  return false;
};
const literalViolations = (property, value) => {
  const bare = opaqueValue(value);
  return [...bare.matchAll(NUMERIC_LITERAL)].filter((match) => {
    const before = bare.slice(0, match.index).trimEnd().slice(-1);
    const after = bare.slice(match.index + match[0].length).trimStart()[0];
    const multiplier = before === '*' || before === '/' || after === '*';
    return !allowedLiteral(property, Number(match[1]), (match[2] || '').toLowerCase(), multiplier);
  }).map((match) => match[0]);
};

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
  const clean = stripComments(readFileSync(path.join(ROOT, 'self', file), 'utf8'));
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

/* Tokens and primitives attach to every .pool-home and to the Poolday page root. */
const ROOT_BLOCK = ':root.pool-page, .pool-home';

/* Product UI scripts, and the shared components they import, may write only custom
   properties inline; component rules decide how those values render. */
const checkInlineStyles = () => {
  const uiDir = path.join(ROOT, 'self/ui/pool-home');
  const files = readdirSync(uiDir).filter((file) => file.endsWith('.js')).map((file) => path.join(uiDir, file));
  const shared = new Set();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/from ['"](\.\.\/components\/[\w-]+\.js)['"]/g)) shared.add(path.resolve(uiDir, match[1]));
  }
  for (const file of [...files, ...shared]) {
    const relative = path.relative(path.join(ROOT, 'self'), file);
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

const violations = [];
const report = (layer, line, message) => violations.push(`${layer}:${line} ${message}`);

const varRefs = (value) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

const main = () => {
  const manifest = JSON.parse(readFileSync(path.join(STYLES, 'poolday/layers.json'), 'utf8'));
  const files = [manifest.tokens, manifest.primitives, ...manifest.components];
  if (new Set(files).size !== files.length || files.some(file => !/^[a-z][a-z/-]*\.css$/.test(file))) {
    throw new Error('Poolday layer manifest must contain unique local CSS paths');
  }
  const discovered = readdirSync(path.join(STYLES, 'poolday'), { recursive: true })
    .filter(file => file.endsWith('.css')).sort();
  if (JSON.stringify(discovered) !== JSON.stringify([...files].sort())) {
    report('layers.json', 1, 'every Poolday stylesheet must belong to exactly one layer');
  }
  const entry = readFileSync(path.join(ROOT, 'self/pool-entry.html'), 'utf8');
  const linked = [...entry.matchAll(/href=["']\/styles\/poolday\/([^"'?]+)(?:\?[^"']*)?["']/g)].map(match => match[1]);
  const fallback = readFileSync(path.join(ROOT, 'self/index.html'), 'utf8');
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
  const tokens = readLayer(manifest.tokens);
  const primitives = readLayer(manifest.primitives);
  const componentLayers = manifest.components.map(readLayer);

  walkDeclarations(tokens.clean, ({ property, value, line, context }) => {
    if (context[0].replace(/\s+/g, ' ') !== ROOT_BLOCK) {
      report(tokens.file, line, `declaration outside the ${ROOT_BLOCK} token block (${context.join(' > ')})`);
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
      } else if (!ref.startsWith('--pool-')) {
        report(tokens.file, line, `token ${property} references non-Poolday var ${ref}`);
      }
    }
  });

  walkDeclarations(primitives.clean, ({ property, value, line, context }) => {
    if (inKeyframes(context)) return;
    if (!property.startsWith('--')) {
      report(primitives.file, line, `style rule in primitive layer: ${context.join(' > ')} { ${property} }`);
      return;
    }
    if (!isPrimitiveName(property)) {
      report(primitives.file, line, `primitive name outside primitive categories: ${property}`);
    }
    if (COLOR_LITERAL.test(value) || namedColors(value, context).length) {
      report(primitives.file, line, `color literal in primitive ${property}: ${value}`);
    }
    if ([...opaqueValue(value).matchAll(NUMERIC_LITERAL)].some((match) => Number(match[1]) !== 0)) {
      report(primitives.file, line, `primitive ${property} holds a literal; move the raw value to a token: ${value}`);
    }
    for (const ref of varRefs(value)) {
      if (ref.startsWith('--pool-') && !isTokenName(ref)) {
        report(primitives.file, line, `primitive ${property} references non-token pool var ${ref}`);
      } else if (!ref.startsWith('--pool-')) {
        report(primitives.file, line, `primitive ${property} references non-Poolday var ${ref}`);
      }
    }
  });

  for (const components of componentLayers) walkDeclarations(components.clean, ({ property, value, line, context }) => {
    if (property.startsWith('--') && !JS_CONTRACT_VARS.has(property) && !PARAMETER_VAR.test(property)) {
      report(components.file, line, `custom property defined in component layer: ${property}`);
    }
    if (COLOR_LITERAL.test(value) || namedColors(value, context).length) {
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
    if (!property.startsWith('--') || PARAMETER_VAR.test(property)) {
      const literals = literalViolations(property, value);
      if (literals.length) {
        report(components.file, line, `literal ${literals.join(', ')} in component rule; use a primitive (${property}: ${value})`);
      }
    }
  });

  /* Existence check: every --pool-* reference must be defined in some layer.
     Category checks alone cannot catch a well-named but undefined var. */
  const definedPool = new Set();
  for (const layer of [tokens, primitives, ...componentLayers]) {
    for (const match of layer.clean.matchAll(/(--pool-[\w-]+)\s*:/g)) definedPool.add(match[1]);
  }
  for (const layer of [primitives, ...componentLayers]) {
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
