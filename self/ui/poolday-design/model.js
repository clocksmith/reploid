// Reads the Poolday layers as written on disk: tokens, primitives and the component rules that
// consume them. The design page renders this model; nothing here is a second copy of a value.

export const TOKEN_PATTERN = /^--pool-(color|gradient|dim|size|motion-duration|motion-easing|font|layer|alpha|ratio)(-|$)/;
export const TOKEN_GROUPS = [
  ['color', 'Colors'], ['gradient', 'Gradients'], ['dim', 'Dimensions, shadows, angles'], ['size', 'Sizes'],
  ['font', 'Type'], ['motion-duration', 'Durations'], ['motion-easing', 'Easings'], ['layer', 'Stacking'],
  ['alpha', 'Opacity'], ['ratio', 'Ratios']
];
export const PRIMITIVE_GROUPS = [
  ['surface', 'Surfaces'], ['frame', 'Frames'], ['hue', 'Hues and mixes'], ['tint', 'Tints'], ['border', 'Borders'],
  ['space', 'Spacing'], ['px', 'Dimensions'], ['radius', 'Radii'], ['angle', 'Angles'], ['metric', 'Metrics'],
  ['text', 'Text sizes'], ['type', 'Type'], ['opacity', 'Opacity'], ['scale', 'Scales'], ['z', 'Stacking'],
  ['transition', 'Transitions'], ['motion', 'Motion']
];

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Custom-property declarations with the block they sit in: base, light theme or a media query. */
export function parseDeclarations(css) {
  const declarations = []; const stack = []; let buffer = '';
  for (const ch of stripComments(css)) {
    if (ch === '{') { stack.push(buffer.trim()); buffer = ''; }
    else if (ch === '}') { stack.pop(); buffer = ''; }
    else if (ch === ';') {
      const text = buffer.trim(); buffer = '';
      const colon = text.indexOf(':');
      if (!text.startsWith('--') || colon < 0) continue;
      const context = stack.join(' > ');
      declarations.push({
        name: text.slice(0, colon).trim(),
        value: text.slice(colon + 1).trim().replace(/\s+/g, ' '),
        block: context.includes('@media') ? 'media' : /theme='light'/.test(context) ? 'light' : 'base'
      });
    } else buffer += ch;
  }
  return declarations;
}

export const varRefs = (value) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
export const groupOf = (name, groups) => {
  const rest = name.replace(/^--pool-/, '');
  return groups.find(([prefix]) => rest === prefix || rest.startsWith(`${prefix}-`))?.[0] ?? 'other';
};

/** One entry per variable: source values by block, references and reverse references. */
function collect(declarations, file) {
  const entries = new Map();
  for (const { name, value, block } of declarations) {
    const entry = entries.get(name) ?? { name, file, values: {}, refs: new Set(), usedBy: new Set() };
    entry.values[block] ??= value;
    for (const ref of varRefs(value)) entry.refs.add(ref);
    entries.set(name, entry);
  }
  return entries;
}

/** Style rules of the component layers, read from the loaded stylesheets. */
export function componentRules(doc, componentFiles) {
  const rules = [];
  const visit = (rule, sheetFile) => {
    if (rule.cssRules && !rule.selectorText) { for (const child of rule.cssRules) visit(child, sheetFile); return; }
    if (!rule.selectorText) return;
    rules.push({ file: sheetFile, selector: rule.selectorText, refs: varRefs(rule.style.cssText) });
  };
  for (const sheet of doc.styleSheets) {
    const file = componentFiles.find((name) => sheet.href?.split('?')[0].endsWith(`/styles/poolday/${name}`));
    if (!file) continue;
    try { for (const rule of sheet.cssRules) visit(rule, file); } catch { /* cross-origin sheets are not Poolday layers */ }
  }
  return rules;
}

export async function loadModel(doc = document) {
  const manifest = await (await fetch('/styles/poolday/layers.json', { cache: 'no-store' })).json();
  const read = async (file) => (await fetch(`/styles/poolday/${file}`, { cache: 'no-store' })).text();
  const [tokenCss, primitiveCss] = await Promise.all([read(manifest.tokens), read(manifest.primitives)]);
  const tokens = collect(parseDeclarations(tokenCss).filter((d) => TOKEN_PATTERN.test(d.name)), manifest.tokens);
  const primitives = collect(parseDeclarations(primitiveCss).filter((d) => !TOKEN_PATTERN.test(d.name)), manifest.primitives);
  const rules = componentRules(doc, manifest.components);
  for (const entry of [...tokens.values(), ...primitives.values()]) {
    for (const ref of entry.refs) (tokens.get(ref) ?? primitives.get(ref))?.usedBy.add(entry.name);
  }
  for (const rule of rules) for (const ref of new Set(rule.refs)) primitives.get(ref)?.usedBy.add(rule.selector);
  return { manifest, tokens, primitives, rules };
}

/** How to preview a resolved value. */
export function previewKind(name, resolved) {
  const value = resolved.trim();
  if (/gradient\(|url\(/.test(value)) return 'image';
  if (/shadow/.test(name)) return 'shadow';
  if (/^(#|rgba?\(|hsla?\(|color\(|color-mix\(|oklch\(|lab\(|transparent$)/i.test(value)) return 'color';
  if (/family|font-(sans|display|mono)$/.test(name)) return 'family';
  if (/weight/.test(name)) return 'weight';
  if (/^-?[\d.]+(px|rem|em)$/.test(value) || /^(min|max|clamp|calc)\(/.test(value)) return /(leading|tracking)/.test(name) ? 'text' : 'length';
  return 'text';
}

/** The rules and primitives a rendered specimen is made of. Dynamic states count as matched. */
export function composition(doc, rules) {
  const elements = [...doc.querySelectorAll('.pool-home, .pool-home *')];
  const used = new Map(); let matched = 0;
  for (const rule of rules) {
    const selector = rule.selector
      .replace(/::?(before|after|placeholder|selection|marker|backdrop|-webkit-[\w-]+)\b/g, '')
      .replace(/:(hover|focus-visible|focus-within|focus|active|visited)\b/g, ':is(*)');
    let hit = false;
    try { hit = elements.some((element) => element.matches(selector)); } catch { hit = false; }
    if (!hit) continue;
    matched++;
    for (const ref of rule.refs) used.set(ref, (used.get(ref) ?? 0) + 1);
  }
  return { matched, used };
}
