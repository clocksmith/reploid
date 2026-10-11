// Independent task oracle for the retained one-number-per-line chat requests.
const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const words = number => {
  if (number < 20) return SMALL[number];
  if (number < 100) return TENS[Math.floor(number / 10)] + (number % 10 ? ' ' + SMALL[number % 10] : '');
  return SMALL[Math.floor(number / 100)] + ' hundred' + (number % 100 ? ' ' + words(number % 100) : '');
};
const normalize = text => text.trim().toLowerCase().replace(/\.$/, '')
  .replace(/\band\b/g, '').replace(/[\s-]+/g, ' ').trim();

export function compareCountedLines(text, count) {
  if (typeof text !== 'string' || !Number.isSafeInteger(count) || count < 1 || count > 200) {
    throw new Error('Counting oracle requires text and a count from 1 through 200');
  }
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim());
  let firstMismatch = null;
  for (let index = 0; index < Math.max(lines.length, count); index++) {
    const number = index + 1, actual = lines[index] ?? null;
    if (number <= count && actual !== null
      && [String(number), words(number)].includes(normalize(actual))) continue;
    firstMismatch = { line: number, actual, expected: number <= count ? String(number) : null };
    break;
  }
  return { passed: firstMismatch === null, expectedLines: count, actualLines: lines.length, firstMismatch };
}
