// The useful-answer set's mechanical check types (answer-set.json checkTypes), ported from its frozen
// scripts/check.py (sha256 1a303808…) to JavaScript: run_check and grade_arm with the same verdicts and the same
// detail text, including Python's repr formatting, code-point lengths and Unicode-aware regular expressions.
// Automated regression evaluation — not independent acceptance.
import { PyFloat, WS_CLASS, cpSlice, pyEqual, pyFloat, pyJsonLoads, pyRepr, pyRstrip, pySplit, pyStr, pyStrip,
  reFullmatch, reSearch } from './python-compat.js';

export const PORTED_FROM = { file: 'artifacts/useful-answer-set-20261014/scripts/check.py',
  sha256: '1a303808caf85a14745177b8b8c1b51e17684688b16c213310f512d4dc180f34' };

// Python's \s, \S and \d (str patterns) are Unicode-aware.
const S = WS_CLASS;
const NOT_S = WS_CLASS.replace('[', '[^');
const WORD = '[\\p{L}\\p{N}_]';
const NUMBER_TEXT = '-?\\p{Nd}+(?:\\.\\p{Nd}+)?';
const MINUS_SIGN = String.fromCodePoint(0x2212);
const NBSP = String.fromCodePoint(0xa0);

// ---- text helpers ---------------------------------------------------------------------------------

export function normalize(text) {
  text = text.replaceAll(NBSP, ' ').replaceAll('‘', "'").replaceAll('’', "'")
    .replaceAll('“', '"').replaceAll('”', '"');
  text = text.replaceAll('**', '').replaceAll('__', '').replaceAll('`', '');
  return text.replace(/[ \t]+/g, ' ');
}

export function unfence(text) {
  text = pyStrip(text);
  const match = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text);
  return match ? pyStrip(match[1]) : text;
}

function skipLeadIn(text) {
  const lines = pyStrip(text).split('\n');
  if (lines.length && pyStrip(pyStrip(normalize(lines[0])), '*_ ').endsWith(':')) return lines.slice(1).join('\n');
  return text;
}

const ignoreCase = check => !check.caseSensitive;
// str.isdigit: decimal digits plus the superscript and subscript digits.
const isDigit = char => /[\p{Nd}²³¹⁰⁴-⁹₀-₉]/u.test(char);
const isAlnum = char => /[\p{L}\p{N}]/u.test(char);

/** Python's float() accepts any Unicode decimal digit; map them to ASCII first (digits run in blocks of ten). */
function asciiDigits(text) {
  return text.replace(/\p{Nd}/gu, char => {
    if (char >= '0' && char <= '9') return char;
    const code = char.codePointAt(0);
    let start = code;
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start -= 1;
    return String((code - start) % 10);
  });
}

const THOUSANDS = new RegExp(`(?<=\\p{Nd}),(?=\\p{Nd}{3}(?!${WORD}))`, 'gu');

/** Every number written in the text, as floats. */
export function numbersIn(text) {
  text = normalize(text).replaceAll(MINUS_SIGN, '-');
  text = text.replace(THOUSANDS, '');
  text = text.replace(/[$€£]/g, '');
  const chars = Array.from(text);
  // Positions by code point, so the preceding-character tests see what Python sees.
  const offsets = [];
  let unit = 0;
  chars.forEach((char, index) => {
    offsets[unit] = index;
    unit += char.length;
  });
  const values = [];
  for (const match of text.matchAll(/(-?)(\p{Nd}+(?:\.\p{Nd}+)?)/gu)) {
    const start = offsets[match.index];
    if (start > 0 && (isDigit(chars[start - 1]) || chars[start - 1] === '.')) continue;
    const negative = match[1] === '-' && !(start > 0 && isAlnum(chars[start - 1]));
    const value = Number(asciiDigits(match[2]));
    values.push(negative ? -value : value);
  }
  return values;
}

const ARRAY = new RegExp(`\\[${S}*(${NUMBER_TEXT}(?:${S}*,${S}*${NUMBER_TEXT})*)?${S}*\\]`, 'gu');
const COMMA = new RegExp(`${S}*,${S}*`, 'u');

export function arraysIn(text) {
  const found = [];
  for (const match of text.replaceAll(MINUS_SIGN, '-').matchAll(ARRAY)) {
    const inner = match[1];
    found.push(inner ? pyStrip(inner).split(COMMA).map(value => Number(asciiDigits(value))) : []);
  }
  return found;
}

const BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;
const ABBREVIATIONS = new RegExp(`${BOUNDARY}(a\\.m\\.|p\\.m\\.|e\\.g\\.|i\\.e\\.|vs\\.|mr\\.|mrs\\.|ms\\.|dr\\.)`, 'giu');
const RUNS_OF_SPACE = new RegExp(`${S}+`, 'gu');
const SENTENCE_END = new RegExp(`[.!?]+(?=["')\\]]*(${S}|\\n?$))`, 'gu');
const ENDS_WITH_PUNCTUATION = /[.!?]["')\]]*\n?$/u;

export function sentenceCount(text) {
  text = normalize(text).replace(ABBREVIATIONS, match => match.replaceAll('.', ''));
  text = pyStrip(text.replace(RUNS_OF_SPACE, ' '));
  let count = (text.match(SENTENCE_END) || []).length;
  if (text && !ENDS_WITH_PUNCTUATION.test(text)) count += 1;
  return count;
}

const BULLET = new RegExp(`^${S}*[-*+•‣▪◦]${S}+${NOT_S}`, 'u');
const NUMBERED = new RegExp(`^${S}*\\p{Nd}+[.)]${S}+${NOT_S}`, 'u');
const NUMBER_MARK = new RegExp(`^${S}*\\p{Nd}+[.)]${S}+`, 'u');

const floats = values => values.map(pyFloat);
const typeName = value => {
  if (value === null) return 'NoneType';
  if (typeof value === 'string') return 'str';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'bigint') return 'int';
  if (value instanceof PyFloat) return 'float';
  if (Array.isArray(value)) return 'list';
  return 'dict';
};

// ---- checks ---------------------------------------------------------------------------------------

/** run_check: [pass, detail] for one declared check on one answer. */
export function runCheck(check, output) {
  const kind = check.type;
  const text = normalize(output);
  if (kind === 'contains' || kind === 'excludes') {
    const values = (check.any && check.any.length ? check.any : null) || check.all;
    const hay = check.caseSensitive ? text : text.toLowerCase();
    const hits = values.filter(value => hay.includes(check.caseSensitive ? value : value.toLowerCase()));
    if (kind === 'excludes') return [!hits.length, hits.length ? `found ${pyRepr(hits)}` : 'none found'];
    const ok = 'all' in check ? hits.length === values.length : hits.length > 0;
    return [ok, `found ${pyRepr(hits)}`];
  }
  if (kind === 'regex' || kind === 'notRegex') {
    const match = reSearch(check.pattern, text, ignoreCase(check));
    const ok = kind === 'regex' ? match !== null : match === null;
    return [ok, match !== null ? `match ${pyRepr(match)}` : 'no match'];
  }
  if (kind === 'number') {
    const values = numbersIn(output);
    const ok = values.some(value => Math.abs(value - check.value) <= check.tolerance + 1e-9);
    return [ok, `numbers ${pyRepr(floats(values.slice(0, 40)))}`];
  }
  if (kind === 'onlyAnswer') {
    let answer = pyStrip(pyStrip(pyStrip(normalize(unfence(output))), '*_'));
    const chars = Array.from(answer);
    if (chars.length >= 2 && chars[0] === chars[chars.length - 1] && (chars[0] === '"' || chars[0] === "'")) {
      answer = pyStrip(chars.slice(1, -1).join(''));
    }
    if (answer.endsWith('.') || answer.endsWith('!')) answer = pyStrip(answer.slice(0, -1));
    return [reFullmatch(check.pattern, answer, ignoreCase(check)), `answer ${pyRepr(cpSlice(answer, 0, 80))}`];
  }
  if (kind === 'finalArray') {
    const ignore = (check.ignore || []).map(list => list.map(Number));
    const stated = arraysIn(output).filter(list => !ignore.some(other => pyEqual(list, other)));
    const final = stated.length ? stated[stated.length - 1] : null;
    return [final !== null && pyEqual(final, check.equals.map(Number)),
      `final ${final === null ? 'None' : pyRepr(floats(final))}`];
  }
  if (kind === 'bullets' || kind === 'numberedList' || kind === 'lines') {
    const source = kind === 'lines' ? unfence(output) : output;
    const lines = source.split('\n').filter(line => pyStrip(line));
    if (kind === 'lines') return [lines.length === check.count, `${lines.length} lines`];
    const pattern = kind === 'bullets' ? BULLET : NUMBERED;
    const marked = lines.filter(line => pattern.test(line));
    let ok = marked.length === check.count && (!check.only || marked.length === lines.length);
    let detail = `${marked.length} marked of ${lines.length} lines`;
    if (kind === 'numberedList' && ok && 'itemsFrom' in check) {
      const allowed = new Set(check.itemsFrom.map(name => name.toLowerCase()));
      const names = marked.map(line => pyStrip(pyRstrip(pyStrip(pyStrip(pyStrip(normalize(line.replace(NUMBER_MARK, ''))), '*_')),
        '.,;:!')).toLowerCase());
      ok = names.every(name => allowed.has(name)) && (!check.distinct || new Set(names).size === names.length);
      detail += `; items ${pyRepr(names)}`;
    }
    return [ok, detail];
  }
  if (kind === 'words') {
    const source = check.skipLeadIn ? skipLeadIn(output) : output;
    const count = pySplit(normalize(source)).filter(word => /[A-Za-z0-9]/.test(word)).length;
    const ok = (check.min ?? 0) <= count && count <= (check.max ?? Infinity);
    return [ok, `${count} words`];
  }
  if (kind === 'sentences') {
    const source = check.skipLeadIn ? skipLeadIn(output) : output;
    const count = sentenceCount(source);
    const ok = (check.min ?? 0) <= count && count <= (check.max ?? Infinity);
    return [ok, `${count} sentences`];
  }
  if (kind === 'json') {
    let value;
    try {
      value = pyJsonLoads(unfence(output));
    } catch (error) {
      if (error.name !== 'JSONDecodeError') throw error;
      return [false, `not JSON: ${error.message}`];
    }
    const expected = check.equals;
    const keys = Object.keys(expected);
    if (!(value instanceof Map) || value.size !== keys.length || !keys.every(key => value.has(key))) {
      return [false, `keys ${value instanceof Map ? pyRepr([...value.keys()]) : typeName(value)}`];
    }
    const same = keys.every(key => (typeof expected[key] === 'string'
      ? pyStrip(pyStr(value.get(key))).toLowerCase() === pyStrip(expected[key]).toLowerCase()
      : pyEqual(value.get(key), expected[key])));
    return [same, `value ${pyRepr(value)}`];
  }
  throw new Error(`unknown check type ${kind}`);
}

// ---- scoring --------------------------------------------------------------------------------------

/** grade_arm for one item and one run item (review omitted, so rubric items stay ungraded). */
export function gradeArm(item, runItem, review = {}) {
  const turns = [];
  let allPass = true;
  let overLimit = false;
  item.turns.forEach((spec, index) => {
    if (index >= runItem.turns.length) {
      turns.push({ turn: index + 1, notRun: true, pass: false });
      allPass = false;
      return;
    }
    const row = runItem.turns[index];
    overLimit = overLimit || Boolean(row.overPromptLimit);
    const empty = !pyStrip(row.output);
    const checks = spec.checks.map(check => {
      const [ok, detail] = runCheck(check, row.output);
      return { type: check.type, pass: ok, detail };
    });
    const turnPass = !empty && checks.every(check => check.pass);
    allPass = allPass && turnPass;
    turns.push({ turn: index + 1, promptTokenCount: row.promptTokenCount ?? null, overPromptLimit: row.overPromptLimit,
      output: row.output, stopReason: row.stopReason ?? null, decodeSteps: row.decodeSteps ?? null, seconds: row.seconds ?? null,
      reusedFrom: row.reusedFrom ?? null, minMarginTop1Top2: row.minMarginTop1Top2 ?? null, empty, checks, pass: turnPass });
  });
  const result = { turns, overPromptLimit: overLimit };
  if (item.judgment === 'human') {
    const grade = review.humanItems?.[item.id]?.[runItem.arm] ?? null;
    Object.assign(result, { grading: 'rubric, provisional', pass: grade === null ? null : Boolean(grade.pass) && !overLimit,
      rubricGrade: grade });
  } else {
    Object.assign(result, { grading: 'mechanical', pass: allPass && !overLimit, checksPass: allPass });
  }
  if (overLimit) result.status = 'promptLimitExceeded';
  return result;
}
