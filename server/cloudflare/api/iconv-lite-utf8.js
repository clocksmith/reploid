// Workers bundle stand-in for iconv-lite: the APIs accept only UTF-8 JSON bodies.
const supported = (encoding) => /^utf-?8$/i.test(String(encoding || 'utf-8'));
export function encodingExists(encoding) { return supported(encoding); }
export function decode(buffer, encoding) {
  if (!supported(encoding)) throw new Error(`Unsupported encoding: ${encoding}`);
  return new TextDecoder('utf-8').decode(buffer);
}
export function getDecoder(encoding) {
  if (!supported(encoding)) throw new Error(`Unsupported encoding: ${encoding}`);
  const decoder = new TextDecoder('utf-8');
  return { write: (chunk) => decoder.decode(chunk, { stream: true }), end: () => decoder.decode() };
}
export default { encodingExists, decode, getDecoder };
