/** Append-only JSONL sink for the native host's readiness records (reploid/measurement readiness-records.js).
 * Off unless the operator names an absolute path; there is no default location. Each record is one line, written in
 * order. A line cut short by a crash is ended before the next write so it cannot join a later record; the CLI reports
 * such lines as unreadable. Write failures go to `onError` and never stop contribution. */
import fs from 'node:fs/promises';
import path from 'node:path';

export async function openNativeReadinessLog({ file, onError = () => {} }) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('--readiness-log requires an absolute file path');
  const handle = await fs.open(file, 'a+', 0o600);
  try {
    const stat = await handle.stat();
    if (stat.isFile() && stat.size > 0) {
      const last = Buffer.alloc(1);
      await handle.read(last, 0, 1, stat.size - 1);
      if (last[0] !== 0x0a) await handle.write('\n');
    }
  } catch (error) { await handle.close(); throw error; }
  let tail = Promise.resolve(), closing = null;
  return Object.freeze({
    file,
    write(record) {
      if (closing) { onError(new Error('Readiness log is closed')); return; }
      const line = JSON.stringify(record) + '\n';
      tail = tail.then(() => handle.write(line)).catch(error => onError(error));
    },
    /** Waits for every accepted record, then closes the file. */
    close: () => closing ||= tail.then(() => handle.close())
  });
}
