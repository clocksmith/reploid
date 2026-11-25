import type { TokenValues } from '../domain/designIndex';

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Declared token values per theme, parsed from the stylesheet text. */
export function parseTokenValues(css: string): TokenValues {
  const values = new Map<string, { dark: string; light: string | null }>();
  const stack: string[] = [];
  let buffer = '';
  for (const ch of stripComments(css)) {
    if (ch === '{') {
      stack.push(buffer.trim());
      buffer = '';
    } else if (ch === '}') {
      stack.pop();
      buffer = '';
    } else if (ch === ';') {
      const text = buffer.trim();
      buffer = '';
      const colon = text.indexOf(':');
      const context = stack.join(' > ');
      if (!text.startsWith('--pool-') || colon < 0 || context.includes('@media')) continue;
      const name = text.slice(0, colon).trim();
      const value = text.slice(colon + 1).trim().replace(/\s+/g, ' ');
      const entry = values.get(name) ?? { dark: value, light: null };
      if (/theme='light'/.test(context)) entry.light = value === entry.dark ? null : value;
      else entry.dark = value;
      values.set(name, entry);
    } else buffer += ch;
  }
  return values;
}

/** Reads tokens.css as served, so the page shows exactly the values the app loads. */
export async function loadTokenValues(url = '/styles/poolday/tokens.css'): Promise<TokenValues> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`tokens.css responded ${response.status}`);
  return parseTokenValues(await response.text());
}
