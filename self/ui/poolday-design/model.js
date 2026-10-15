// Reads the Poolday layers as written on disk: tokens, primitive classes and the compositions
// that arrange them. The design page renders this model; nothing here copies a value.

export const TOKEN_GROUPS = [
  ['gray', 'Palette: grays'], ['alpha', 'Palette: alpha'], ['color', 'Semantic colors'], ['size', 'Sizes'],
  ['radius', 'Radii'], ['border', 'Borders'], ['text', 'Text sizes'], ['leading', 'Line heights'], ['weight', 'Weights'],
  ['tracking', 'Tracking'], ['font', 'Font families'], ['shadow', 'Shadows'], ['depth', 'Depth'], ['surface', 'Surfaces and gradients'],
  ['frame', 'Frames'], ['metric', 'Layout metrics'], ['space', 'Page spacing'], ['transition', 'Transitions'], ['motion', 'Motion'],
  ['z', 'Stacking'], ['angle', 'Angles'], ['scale', 'Scales']
];
export const VISUAL_PROPERTY = /^(color|background(-color|-image)?|border(-(top|bottom|left|right|block|inline))?(-color|-style)?|border-radius|box-shadow|font(-size|-weight|-family)?|line-height|letter-spacing|text-transform|opacity|filter|backdrop-filter|-webkit-backdrop-filter|outline(-color)?|text-decoration|text-shadow|mask-image|-webkit-mask-image)$/;

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

/** Style rules of the given layer files, read from the loaded stylesheets. */
export function layerRules(doc, files) {
  const rules = [];
  const visit = (rule, file) => {
    if (rule.cssRules && !rule.selectorText) { for (const child of rule.cssRules) visit(child, file); return; }
    if (!rule.selectorText) return;
    const declarations = rule.style.cssText.split(';').map((text) => text.split(':')[0].trim()).filter(Boolean);
    rules.push({ file, selector: rule.selectorText, refs: varRefs(rule.style.cssText), visuals: declarations.filter((p) => VISUAL_PROPERTY.test(p)).length });
  };
  for (const sheet of doc.styleSheets) {
    const file = files.find((name) => sheet.href?.split('?')[0].endsWith(`/styles/poolday/${name}`));
    if (!file) continue;
    try { for (const rule of sheet.cssRules) visit(rule, file); } catch { /* cross-origin sheets are not Poolday layers */ }
  }
  return rules;
}

export async function loadModel(doc = document) {
  const manifest = await (await fetch('/styles/poolday/layers.json', { cache: 'no-store' })).json();
  const css = await (await fetch(`/styles/poolday/${manifest.tokens}`, { cache: 'no-store' })).text();
  const tokens = new Map();
  for (const { name, value, block } of parseDeclarations(css)) {
    const entry = tokens.get(name) ?? { name, file: manifest.tokens, values: {}, refs: new Set(), usedBy: new Set() };
    entry.values[block] ??= value;
    for (const ref of varRefs(value)) entry.refs.add(ref);
    tokens.set(name, entry);
  }
  const primitiveRules = layerRules(doc, manifest.primitives);
  const compositionRules = layerRules(doc, manifest.compositions);
  for (const entry of tokens.values()) for (const ref of entry.refs) tokens.get(ref)?.usedBy.add(entry.name);
  for (const rule of [...primitiveRules, ...compositionRules]) for (const ref of new Set(rule.refs)) tokens.get(ref)?.usedBy.add(rule.selector);
  const primitiveClasses = new Set(primitiveRules.flatMap((rule) => [...rule.selector.matchAll(/\.((?:pool|btn)-[\w-]+)/g)].map((m) => m[1]))
    .filter((name) => !['pool-home', 'pool-page', 'pool-work-shell'].includes(name) && !/^pool-(work|thread|control|agent)-/.test(name)));
  return { manifest, tokens, primitiveRules, compositionRules, primitiveClasses };
}

/** How to preview a resolved value. */
export function previewKind(name, resolved) {
  const value = resolved.trim();
  if (/gradient\(|url\(/.test(value)) return 'image';
  if (/shadow/.test(name)) return 'shadow';
  if (/^(#|rgba?\(|hsla?\(|color\(|color-mix\(|oklch\(|lab\(|transparent$)/i.test(value)) return 'color';
  if (/^--pool-font-/.test(name)) return 'family';
  if (/^--pool-weight-/.test(name)) return 'weight';
  if (/^-?[\d.]+(px|rem|em)$/.test(value) || /^(min|max|clamp|calc)\(/.test(value)) return /(leading|tracking)/.test(name) ? 'text' : 'length';
  return 'text';
}

const matches = (elements, selector) => {
  const live = selector.replace(/::?(before|after|placeholder|selection|marker|backdrop|-webkit-[\w-]+)\b/g, '')
    .replace(/:(hover|focus-visible|focus-within|focus|active|visited)\b/g, ':is(*)');
  try { return elements.some((element) => element.matches(live)); } catch { return false; }
};

/** What a rendered specimen is made of: tokens used, primitive classes present, and the
    visual declarations its composition rules still carry instead of taking them from primitives. */
export function composition(doc, model) {
  const elements = [...doc.querySelectorAll('.pool-home, .pool-home *')];
  const tokens = new Map(); const primitives = new Map(); let bespoke = 0;
  for (const rule of [...model.primitiveRules, ...model.compositionRules]) {
    if (!matches(elements, rule.selector)) continue;
    for (const ref of rule.refs) if (model.tokens.has(ref)) tokens.set(ref, (tokens.get(ref) ?? 0) + 1);
    if (model.compositionRules.includes(rule)) bespoke += rule.visuals;
  }
  for (const element of elements) for (const name of element.classList) {
    if (model.primitiveClasses.has(name)) primitives.set(name, (primitives.get(name) ?? 0) + 1);
  }
  return { tokens, primitives, bespoke };
}
