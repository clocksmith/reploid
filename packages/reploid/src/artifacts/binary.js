/** Binary encodings shared by signed artifacts and host transport adapters. */
export function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  const text = String(value || '');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
  return Uint8Array.from(atob(text), character => character.charCodeAt(0));
}

export function toBase64Url(value) {
  return bytesToBase64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(value) {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(text.padEnd(Math.ceil(text.length / 4) * 4, '='));
}
