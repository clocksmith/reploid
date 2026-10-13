// Read-only aggregate; never prints signed Capsule bodies or individual records.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const file = process.argv[2];
const bytes = fs.readFileSync(file), sizes = [], capsules = [], events = {};
let malformed = 0;
function scan(value) {
  if (!value || typeof value !== 'object') return;
  if (value.capsuleVerification) capsules.push(Buffer.byteLength(JSON.stringify(value.capsuleVerification)));
  for (const child of Object.values(value)) if (child && typeof child === 'object') scan(child);
}
for (const line of bytes.toString().split('\n')) {
  if (!line) continue;
  try {
    const row = JSON.parse(line), key = row.event ?? '(no event)', size = Buffer.byteLength(line);
    events[key] ??= { count: 0, bytes: 0, maxBytes: 0 };
    events[key].count++; events[key].bytes += size; events[key].maxBytes = Math.max(events[key].maxBytes, size);
    if (key === 'partition-state') { sizes.push(size); scan(row); }
  } catch { malformed++; }
}
sizes.sort((a, b) => a - b); capsules.sort((a, b) => a - b);
console.log(JSON.stringify({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  events, nonJSONLines: malformed,
  partitionState: { count: sizes.length, medianBytes: sizes[Math.floor(sizes.length / 2)], maxBytes: sizes.at(-1) },
  capsuleVerification: { count: capsules.length, medianBytes: capsules[Math.floor(capsules.length / 2)], maxBytes: capsules.at(-1) }
}, null, 2));
