/**
 * @fileoverview Durable filesystem Change Passport store for one hosted instance.
 */

import fs from 'fs/promises';
import path from 'path';

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const SAFE_FILE_ID = /^[a-zA-Z0-9._:@+~-]+$/;

const safeId = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized || !SAFE_FILE_ID.test(normalized)) throw new Error(`${label} is unsafe`);
  return normalized;
};

const readJson = async (filePath, fallback) => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return cloneJson(fallback);
    throw error;
  }
};

const readJsonl = async (filePath) => {
  try {
    return (await fs.readFile(filePath, 'utf8'))
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const writeJsonAtomic = async (filePath, value) => {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(tempPath, filePath);
};

export function createFileChangeControlStore({ rootDir }) {
  const root = path.resolve(String(rootDir || ''));
  if (!rootDir || root === path.parse(root).root) throw new Error('A bounded change-control rootDir is required');
  const queues = new Map();

  const passportDir = (passportId) => path.join(root, 'passports', safeId(passportId, 'passportId'));
  const eventPath = (passportId) => path.join(passportDir(passportId), 'events.jsonl');
  const idempotencyPath = (passportId) => path.join(passportDir(passportId), 'idempotency.json');
  const deliveryPath = (source, deliveryId) => path.join(
    root,
    'deliveries',
    safeId(source, 'delivery source'),
    `${safeId(deliveryId, 'deliveryId')}.json`
  );

  const serialize = (key, operation) => {
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.then(operation, operation);
    const queued = next.catch(() => {});
    queues.set(key, queued);
    return next.finally(() => {
      if (queues.get(key) === queued) queues.delete(key);
    });
  };

  const useIdempotency = async (passportId, key, requestHash, operation) => {
    const filePath = idempotencyPath(passportId);
    const records = await readJson(filePath, {});
    const prior = records[key];
    if (prior) {
      if (prior.requestHash !== requestHash) throw new Error('idempotency key reused with different input');
      return cloneJson(prior.result);
    }
    const result = await operation();
    records[key] = { requestHash, result: cloneJson(result) };
    await writeJsonAtomic(filePath, records);
    return result;
  };

  return {
    kind: 'file',

    async createPassport({ passportId, event, idempotencyKey, requestHash }) {
      const id = safeId(passportId, 'passportId');
      return serialize(id, async () => {
        const directory = passportDir(id);
        await fs.mkdir(directory, { recursive: true });
        return useIdempotency(id, `create:${idempotencyKey}`, requestHash, async () => {
          const existing = await readJsonl(eventPath(id));
          if (existing?.length) throw new Error('passport already exists');
          await fs.writeFile(eventPath(id), `${JSON.stringify(event)}\n`, { flag: 'wx' });
          return { passportId: id, sequence: 1, event: cloneJson(event) };
        });
      });
    },

    async appendEvent({ passportId, event, expectedSequence, idempotencyKey, requestHash }) {
      const id = safeId(passportId, 'passportId');
      return serialize(id, async () => useIdempotency(
        id,
        `append:${idempotencyKey}`,
        requestHash,
        async () => {
          const events = await readJsonl(eventPath(id));
          if (!events) throw new Error('passport not found');
          if (events.length !== expectedSequence) {
            const error = new Error(`passport sequence conflict: expected ${expectedSequence}, actual ${events.length}`);
            error.code = 'SEQUENCE_CONFLICT';
            error.actualSequence = events.length;
            throw error;
          }
          if (event.sequence !== expectedSequence + 1) throw new Error('event sequence does not follow expected sequence');
          await fs.appendFile(eventPath(id), `${JSON.stringify(event)}\n`);
          return { passportId: id, sequence: events.length + 1, event: cloneJson(event) };
        }
      ));
    },

    async getEvents(passportId) {
      const events = await readJsonl(eventPath(passportId));
      return events ? cloneJson(events) : null;
    },

    async getIdempotency(passportId, key) {
      const records = await readJson(idempotencyPath(passportId), {});
      const prior = records[key];
      return prior ? cloneJson(prior) : null;
    },

    async listPassportIds() {
      try {
        const entries = await fs.readdir(path.join(root, 'passports'), { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },

    async saveDelivery({ source, deliveryId, requestHash, result }) {
      const filePath = deliveryPath(source, deliveryId);
      return serialize(`delivery:${source}:${deliveryId}`, async () => {
        const prior = await readJson(filePath, null);
        if (prior) {
          if (prior.requestHash !== requestHash) throw new Error('delivery id reused with different input');
          return cloneJson(prior.result);
        }
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await writeJsonAtomic(filePath, { requestHash, result: cloneJson(result) });
        return cloneJson(result);
      });
    },

    async getDelivery(source, deliveryId) {
      const prior = await readJson(deliveryPath(source, deliveryId), null);
      return prior ? cloneJson(prior.result) : null;
    },

    async getDeliveryRecord(source, deliveryId) {
      const prior = await readJson(deliveryPath(source, deliveryId), null);
      return prior ? cloneJson(prior) : null;
    }
  };
}

export default createFileChangeControlStore;
