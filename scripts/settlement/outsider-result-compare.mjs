/**
 * How an outside-verifier package's `verify.mjs` compares what a verifier gives now with the result listed in the
 * package's expected.json (scripts/settlement/outsider-package.js copies this file into both kinds of package).
 *
 * A verifier newer than the package may report more than the one the package was made with: a later commit adds
 * fields such as `facts.hold.verified`. Those are information, never a difference. Every field the expected result
 * has must still be there with the same value: each verdict (`ok`), outcome, debit, payout, forfeit, hold amount,
 * stage line and the number of problems. Payouts, accounts and forfeits are compared whole, so a payout to an account
 * the expected result does not list is a difference, not an added field. Only prose may change wording without
 * failing: the text of each problem and the `accountsFrom` sentence; that is reported as information too.
 *
 * Plain JavaScript, no imports: the package runs it with Node alone.
 */

/** Compared as one value: any change inside is a difference. */
const WHOLE = new Set(['payouts', 'accounts', 'forfeited', 'ownAccountStages', 'credits']);
/** Sentences, not verdicts or amounts: another wording is information. */
const PROSE = new Set(['accountsFrom']);

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function show(value) {
  const text = canonical(value);
  if (text === undefined) return 'nothing';
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/**
 * Compares one trade's result. `expected` and `actual` are `{ ok, attempts }`. Returns `{ same, differences, added,
 * reworded }`: `same` is false exactly when `differences` is not empty. Each entry names its place, for example
 * `attempt "answer": facts.debit`.
 */
export function compareResult(expected, actual) {
  const differences = [], added = [], reworded = [];
  const differ = (where, want, got) => differences.push(`${where}: expected ${show(want)}, this verifier gives ${show(got)}`);
  const walk = (want, got, where, key, prose) => {
    if (WHOLE.has(key) || !(isObject(want) || Array.isArray(want))) {
      if (canonical(want) === canonical(got)) return;
      if (prose && typeof want === 'string' && typeof got === 'string') reworded.push(where);
      else differ(where, want, got);
      return;
    }
    if (Array.isArray(want)) {
      if (!Array.isArray(got) || got.length !== want.length) return differ(where, want, got);
      want.forEach((item, index) => walk(item, got[index], `${where}[${index}]`, key, key === 'problems'));
      return;
    }
    if (!isObject(got)) return differ(where, want, got);
    for (const name of Object.keys(want)) {
      const next = where ? `${where}.${name}` : name;
      if (!Object.hasOwn(got, name)) differences.push(`${next}: the expected result has it, this verifier does not give it`);
      else walk(want[name], got[name], next, name, PROSE.has(name));
    }
    for (const name of Object.keys(got)) if (!Object.hasOwn(want, name)) added.push({ field: where ? `${where}.${name}` : name, value: got[name] });
  };
  if (expected.ok !== actual.ok) differ('the trade\'s verdict (ok)', expected.ok, actual.ok);
  const want = expected.attempts ?? [], got = actual.attempts ?? [];
  if (want.length !== got.length) differ('the number of attempts', want.length, got.length);
  want.forEach((row, index) => {
    const label = `attempt "${row?.name ?? index}"`;
    if (index >= got.length) return;
    if (got[index]?.name !== row?.name) return differ(`${label}: its name`, row?.name, got[index]?.name);
    const before = differences.length, firstAdded = added.length, firstReworded = reworded.length;
    walk(row, got[index], '', null, false);
    for (let at = before; at < differences.length; at += 1) differences[at] = `${label}: ${differences[at]}`;
    for (let at = firstAdded; at < added.length; at += 1) added[at] = { ...added[at], attempt: row.name };
    for (let at = firstReworded; at < reworded.length; at += 1) reworded[at] = `${label}: ${reworded[at]}`;
  });
  return { same: differences.length === 0, differences, added, reworded };
}

/** The lines verify.mjs prints under a trade for one comparison: what differs, and what is information only. */
export function comparisonLines({ differences, added, reworded }) {
  const lines = differences.map(line => `DIFFERS: ${line}`);
  if (added.length) {
    const fields = new Map();
    for (const row of added) fields.set(row.field, [...(fields.get(row.field) ?? []), row]);
    const list = [...fields].map(([field, rows]) => {
      const values = [...new Set(rows.map(row => show(row.value)))];
      return `${field} (${rows.length} attempt${rows.length === 1 ? '' : 's'}: ${values.length === 1 ? values[0] : values.join(' or ')})`;
    });
    lines.push(`information: this verifier also reports ${list.join('; ')}. The expected result was made without ${fields.size === 1 ? 'this field' : 'these fields'}; ${fields.size === 1 ? 'it changes' : 'they change'} no verdict or amount.`);
  }
  if (reworded.length) lines.push(`information: worded differently from the expected result, with the same verdict: ${reworded.join('; ')}.`);
  return lines;
}
