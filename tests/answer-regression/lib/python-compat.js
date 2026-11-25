// Python-compatible text semantics for the mechanical checks, so verdicts and detail strings stay equal to the
// records the earlier Python harness wrote (results.json, baselines/*/evaluation.json). Nothing here runs Python:
// it reimplements the few str, repr, re and json behaviours the frozen check semantics name.

// ---- strings by code point ----------------------------------------------------------------------

export const cpLength = text => Array.from(text).length;
export const cpSlice = (text, start, end) => Array.from(text).slice(start, end).join('');

// str.isspace characters.
export const WS = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
export const WS_CLASS = `[${WS}]`;
const LEADING_WS = new RegExp(`^${WS_CLASS}+`);
const TRAILING_WS = new RegExp(`${WS_CLASS}+$`);
const SPLIT_WS = new RegExp(`${WS_CLASS}+`);

const escapeClass = chars => chars.replace(/[\\\]^-]/g, '\\$&');

/** str.strip() or str.strip(chars). */
export function pyStrip(text, chars = null) {
  if (chars === null) return text.replace(LEADING_WS, '').replace(TRAILING_WS, '');
  const set = `[${escapeClass(chars)}]`;
  return text.replace(new RegExp(`^${set}+`, 'u'), '').replace(new RegExp(`${set}+$`, 'u'), '');
}

/** str.rstrip(chars). */
export const pyRstrip = (text, chars) => text.replace(new RegExp(`[${escapeClass(chars)}]+$`, "u"), "");

/** str.split() with no separator. */
export const pySplit = text => pyStrip(text).split(SPLIT_WS).filter(Boolean);

/** str.splitlines(). */
export function pySplitlines(text) {
  const lines = text.split(/\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ---- repr / str -----------------------------------------------------------------------------------

/** A Python float, kept apart from int (BigInt) so repr and str match. */
export class PyFloat {
  constructor(value) {
    this.value = value;
  }
}

export const pyFloat = value => new PyFloat(value);

/** float.__repr__: shortest round-trip digits; scientific below 1e-4 and from 1e16. */
export function floatRepr(value) {
  if (Number.isNaN(value)) return 'nan';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const [mantissa, exponentText] = value.toExponential().split('e');
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '').replace('.', '');
  let body;
  if (exponent < -4 || exponent >= 16) {
    const lead = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    body = `${lead}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
  } else if (exponent >= digits.length - 1) {
    body = `${digits}${'0'.repeat(exponent - digits.length + 1)}.0`;
  } else if (exponent >= 0) {
    body = `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
  } else {
    body = `0.${'0'.repeat(-exponent - 1)}${digits}`;
  }
  return negative ? `-${body}` : body;
}

const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** str.__repr__. */
export function stringRepr(text) {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (char === quote || char === '\\') out += `\\${char}`;
    else if (char === '\t') out += '\\t';
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char !== ' ' && NON_PRINTABLE.test(char)) {
      if (code < 0x100) out += `\\x${code.toString(16).padStart(2, '0')}`;
      else if (code < 0x10000) out += `\\u${code.toString(16).padStart(4, '0')}`;
      else out += `\\U${code.toString(16).padStart(8, '0')}`;
    } else out += char;
  }
  return out + quote;
}

/** repr() of a JSON-like value: string, number (int when integral), BigInt (int), PyFloat, bool, null, list, dict. */
export function pyRepr(value) {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return stringRepr(value);
  if (typeof value === 'bigint') return String(value);
  if (value instanceof PyFloat) return floatRepr(value.value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : floatRepr(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  if (value instanceof Map) return `{${[...value].map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}}`;
  return `{${Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}}`;
}

/** str() of a value: strings unchanged, everything else as repr. */
export const pyStr = value => (typeof value === 'string' ? value : pyRepr(value));

/** Python ==: numbers compare by value (True == 1), lists and dicts element-wise. */
export function pyEqual(a, b) {
  const scalar = value => (value instanceof PyFloat ? value.value : value);
  a = scalar(a);
  b = scalar(b);
  const numeric = value => typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean';
  if (numeric(a) && numeric(b)) {
    const toNumber = value => (typeof value === 'boolean' ? Number(value) : value);
    return toNumber(a) == toNumber(b); // BigInt and number compare by value only with ==.
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => pyEqual(value, b[index]));
  }
  const entries = value => (value instanceof Map ? [...value] : value && typeof value === 'object' ? Object.entries(value) : null);
  const x = entries(a);
  const y = entries(b);
  if (x || y) {
    if (!x || !y || x.length !== y.length) return false;
    const other = new Map(y);
    return x.every(([key, value]) => other.has(key) && pyEqual(value, other.get(key)));
  }
  return a === b;
}

// ---- json.dumps (default separators, ensure_ascii) ---------------------------------------------

export function pyJsonDumps(value) {
  if (value === null || value === undefined) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'bigint') return String(value);
  if (value instanceof PyFloat) return floatRepr(value.value).replace('nan', 'NaN').replace('inf', 'Infinity');
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : floatRepr(value);
  if (typeof value === 'string') {
    return JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  }
  if (Array.isArray(value)) return `[${value.map(pyJsonDumps).join(', ')}]`;
  return `{${Object.entries(value).map(([k, v]) => `${pyJsonDumps(k)}: ${pyJsonDumps(v)}`).join(', ')}}`;
}

// ---- json.loads (strict, with CPython's error messages) ----------------------------------------

export class PyJsonDecodeError extends Error {
  constructor(message, doc, pos) {
    const lineno = (doc.slice(0, pos).match(/\n/g) || []).length + 1;
    const lastNewline = doc.lastIndexOf('\n', pos - 1);
    const colno = lastNewline === -1 || pos === 0 ? pos + 1 : pos - lastNewline;
    super(`${message}: line ${lineno} column ${colno} (char ${pos})`);
    this.name = 'JSONDecodeError';
  }
}

const JSON_WS = /[ \t\n\r]*/y;
const NUMBER = /(-?(?:0|[1-9][0-9]*))(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * json.loads(text): objects become Maps (insertion order, duplicate keys last-wins), ints BigInt, floats PyFloat.
 * Positions count UTF-16 units; they equal Python's code-point positions for BMP text.
 */
export function pyJsonLoads(text) {
  const doc = text;
  if (doc.startsWith('\ufeff')) throw new PyJsonDecodeError('Unexpected UTF-8 BOM (decode using utf-8-sig)', doc, 0);
  const skip = index => {
    JSON_WS.lastIndex = index;
    JSON_WS.exec(doc);
    return JSON_WS.lastIndex;
  };
  const scanString = end => {
    const begin = end - 1;
    let out = '';
    for (;;) {
      let index = end;
      while (index < doc.length && doc[index] !== '"' && doc[index] !== '\\' && doc.charCodeAt(index) >= 0x20) index += 1;
      if (index >= doc.length) throw new PyJsonDecodeError('Unterminated string starting at', doc, begin);
      out += doc.slice(end, index);
      const terminator = doc[index];
      end = index + 1;
      if (terminator === '"') return [out, end];
      if (terminator !== '\\') throw new PyJsonDecodeError('Invalid control character at', doc, index);
      if (end >= doc.length) throw new PyJsonDecodeError('Unterminated string starting at', doc, begin);
      const escape = doc[end];
      if (escape !== 'u') {
        if (!(escape in ESCAPES)) throw new PyJsonDecodeError('Invalid \\escape', doc, end - 1);
        out += ESCAPES[escape];
        end += 1;
        continue;
      }
      const hex = doc.slice(end + 1, end + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new PyJsonDecodeError('Invalid \\uXXXX escape', doc, end);
      let code = parseInt(hex, 16);
      end += 5;
      if (code >= 0xd800 && code <= 0xdbff && doc.slice(end, end + 2) === '\\u') {
        const low = doc.slice(end + 2, end + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(low)) throw new PyJsonDecodeError('Invalid \\uXXXX escape', doc, end + 1);
        const second = parseInt(low, 16);
        if (second >= 0xdc00 && second <= 0xdfff) {
          code = 0x10000 + (((code - 0xd800) << 10) | (second - 0xdc00));
          end += 6;
        }
      }
      out += String.fromCodePoint(code);
    }
  };
  const scan = index => {
    if (index >= doc.length) throw new PyJsonDecodeError('Expecting value', doc, index);
    const char = doc[index];
    if (char === '"') return scanString(index + 1);
    if (char === '{') return scanObject(index + 1);
    if (char === '[') return scanArray(index + 1);
    if (doc.startsWith('null', index)) return [null, index + 4];
    if (doc.startsWith('true', index)) return [true, index + 4];
    if (doc.startsWith('false', index)) return [false, index + 5];
    NUMBER.lastIndex = index;
    const number = NUMBER.exec(doc);
    if (number) {
      const end = NUMBER.lastIndex;
      if (number[2] || number[3]) return [pyFloat(Number(number[0])), end];
      return [BigInt(number[1]), end];
    }
    if (doc.startsWith('NaN', index)) return [pyFloat(NaN), index + 3];
    if (doc.startsWith('Infinity', index)) return [pyFloat(Infinity), index + 8];
    if (doc.startsWith('-Infinity', index)) return [pyFloat(-Infinity), index + 9];
    throw new PyJsonDecodeError('Expecting value', doc, index);
  };
  const scanObject = start => {
    const value = new Map();
    let end = skip(start);
    if (doc[end] === '}') return [value, end + 1];
    if (doc[end] !== '"') throw new PyJsonDecodeError('Expecting property name enclosed in double quotes', doc, end);
    for (;;) {
      const [key, afterKey] = scanString(end + 1);
      end = skip(afterKey);
      if (doc[end] !== ':') throw new PyJsonDecodeError("Expecting ':' delimiter", doc, end);
      end = skip(end + 1);
      const [inner, afterValue] = scan(end);
      value.set(key, inner);
      end = skip(afterValue);
      if (doc[end] === '}') return [value, end + 1];
      if (doc[end] !== ',') throw new PyJsonDecodeError("Expecting ',' delimiter", doc, end);
      const comma = end;
      end = skip(end + 1);
      if (doc[end] === '}') throw new PyJsonDecodeError('Illegal trailing comma before end of object', doc, comma);
      if (doc[end] !== '"') throw new PyJsonDecodeError('Expecting property name enclosed in double quotes', doc, end);
    }
  };
  const scanArray = start => {
    const value = [];
    let end = skip(start);
    if (doc[end] === ']') return [value, end + 1];
    for (;;) {
      const [inner, afterValue] = scan(end);
      value.push(inner);
      end = skip(afterValue);
      if (doc[end] === ']') return [value, end + 1];
      if (doc[end] !== ',') throw new PyJsonDecodeError("Expecting ',' delimiter", doc, end);
      const comma = end;
      end = skip(end + 1);
      if (doc[end] === ']') throw new PyJsonDecodeError('Illegal trailing comma before end of array', doc, comma);
    }
  };
  const [value, end] = scan(skip(0));
  const tail = skip(end);
  if (tail !== doc.length) throw new PyJsonDecodeError('Extra data', doc, tail);
  return value;
}

// ---- re (search/fullmatch) ------------------------------------------------------------------------

// Python's str-pattern \w, \d and \b are Unicode-aware; JavaScript's are ASCII. Translate the frozen
// patterns so the same text matches the same way. MULTILINE is never used by the checks.
const WORD = '\\p{L}\\p{N}_';
const BOUNDARY = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
const NOT_BOUNDARY = `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`;
const SYNTAX = new Set('^$\\.*+?()[]{}|/'.split(''));
const cache = new Map();

export function translatePattern(pattern) {
  let out = '';
  let inClass = false;
  let index = 0;
  const chars = Array.from(pattern);
  const at = offset => chars[index + offset];
  while (index < chars.length) {
    const char = chars[index];
    if (char === '\\') {
      const next = at(1);
      index += 2;
      if (next === undefined) throw new SyntaxError('bad escape (end of pattern)');
      if (next === 'd') out += '\\p{Nd}';
      else if (next === 'D') out += '\\P{Nd}';
      else if (next === 'w') out += inClass ? WORD : `[${WORD}]`;
      else if (next === 'W') out += inClass ? '\\W' : `[^${WORD}]`;
      else if (next === 's') out += inClass ? WS : WS_CLASS;
      else if (next === 'S') out += inClass ? '\\S' : `[^${WS}]`;
      else if (next === 'b') out += inClass ? '\\x08' : BOUNDARY;
      else if (next === 'B') out += NOT_BOUNDARY;
      else if (next === 'A') out += '^';
      else if (next === 'Z') out += '(?![\\s\\S])';
      else if (/[0-9nrtfvx]/.test(next)) out += `\\${next}`;
      else if (next === 'u' || next === 'U' || next === 'N') {
        const length = next === 'U' ? 8 : 4;
        const hex = chars.slice(index, index + length).join('');
        if (next === 'N' || !/^[0-9a-fA-F]+$/.test(hex) || hex.length !== length) throw new SyntaxError(`unsupported escape \\${next}`);
        out += `\\u{${hex}}`;
        index += length;
      } else if (/[A-Za-z]/.test(next)) throw new SyntaxError(`bad escape \\${next}`);
      else if (SYNTAX.has(next) || (inClass && next === '-')) out += `\\${next}`;
      else out += `\\u{${next.codePointAt(0).toString(16)}}`;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
      out += char === '[' ? '\\[' : char;
      index += 1;
      continue;
    }
    if (char === '[') {
      inClass = true;
      out += '[';
      index += 1;
      if (at(0) === '^') {
        out += '^';
        index += 1;
      }
      if (at(0) === ']') {
        out += '\\]';
        index += 1;
      }
      continue;
    }
    if (char === '$') out += '(?=\\n?(?![\\s\\S]))';
    else if (char === '(' && at(1) === '?' && at(2) === 'P' && at(3) === '<') {
      out += '(?<';
      index += 4;
      continue;
    } else if (char === '(' && at(1) === '?' && at(2) === 'P' && at(3) === '=') {
      const close = chars.indexOf(')', index);
      out += `\\k<${chars.slice(index + 4, close).join('')}>`;
      index = close + 1;
      continue;
    } else if (char === '{') {
      const rest = chars.slice(index).join('');
      const quantifier = /^\{(\d*)(?:,(\d*))?\}/.exec(rest);
      if (quantifier && (quantifier[1] || quantifier[2] !== undefined)) {
        out += quantifier[1] ? quantifier[0] : `{0,${quantifier[2]}}`;
        index += Array.from(quantifier[0]).length;
        continue;
      }
      out += '\\{';
    } else if (char === '}' || char === ']') out += `\\${char}`;
    else out += char;
    index += 1;
  }
  return out;
}

function compiled(pattern, ignoreCase, full) {
  const key = `${ignoreCase ? 'i' : '-'}${full ? 'f' : 's'}${pattern}`;
  if (!cache.has(key)) {
    let source = translatePattern(pattern);
    let flags = 'u';
    const inline = /^\(\?([aiLmsux]+)\)/.exec(source);
    if (inline) {
      source = source.slice(inline[0].length);
      if (inline[1].includes('i')) ignoreCase = true;
      if (inline[1].includes('s')) flags += 's';
    }
    if (ignoreCase) flags += 'i';
    cache.set(key, new RegExp(full ? `^(?:${source})(?![\\s\\S])` : source, flags));
  }
  return cache.get(key);
}

/** re.search: the first match's text, or null. */
export function reSearch(pattern, text, ignoreCase = false) {
  const match = compiled(pattern, ignoreCase, false).exec(text);
  return match ? match[0] : null;
}

/** re.fullmatch. */
export const reFullmatch = (pattern, text, ignoreCase = false) => compiled(pattern, ignoreCase, true).test(text);
