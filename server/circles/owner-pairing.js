import { randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { OWNER_PAIRING_REQUEST, OWNER_PAIRING_RESULT, ownerPairingCode, ownerPairingRequestId, ownerParticipantId }
  from '../../packages/reploid/src/transport/index.js';

const PAIRING_TTL_MS = 120000;

/** Local desktop approval survives restarts. Codes and pending approvals do not. */
export async function openOwnerPairing({ file, hostParticipantId, onRequest = () => {}, now = Date.now }) {
  if (!path.isAbsolute(file) || !ownerParticipantId(hostParticipantId)) throw Error('An owner pairing file and desktop identity are required');
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await fs.open(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) !== 0 || process.getuid && info.uid !== process.getuid()) {
      throw Error('Owner pairing state must be a regular file accessible only to the desktop owner');
    }
  } finally { await handle.close(); }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS desktop (id INTEGER PRIMARY KEY CHECK (id = 1), participant TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_device (participant TEXT PRIMARY KEY);`);
    db.prepare('INSERT OR IGNORE INTO desktop (id, participant) VALUES (1, ?)').run(hostParticipantId);
    if (db.prepare('SELECT participant FROM desktop WHERE id = 1').get().participant !== hostParticipantId) {
      throw Error('Owner pairing state belongs to another desktop identity');
    }
  } catch (error) { db.close(); throw error; }
  const addOwner = db.prepare('INSERT OR IGNORE INTO owner_device (participant) VALUES (?)');
  const hasOwner = db.prepare('SELECT 1 FROM owner_device WHERE participant = ?');
  let offer, pending, version = 0, attached = false, closed = false;
  const assertOpen = () => { if (closed) throw Error('Owner pairing is closed'); };
  const clearPending = () => {
    const previous = pending;
    pending = null;
    if (previous) previous.respond(false);
  };
  return Object.freeze({
    hostParticipantId,
    isOwner: participant => !closed && ownerParticipantId(participant) && !!hasOwner.get(participant),
    issue() {
      assertOpen();
      clearPending();
      version++;
      offer = { code: randomBytes(18).toString('base64url'), expiresAt: now() + PAIRING_TTL_MS };
      return { hostParticipantId, ...offer };
    },
    decide(requestId, approved) {
      assertOpen();
      if (!pending || pending.requestId !== requestId) throw Error('No matching owner pairing request');
      const selected = pending;
      pending = null;
      if (approved === true && selected.expiresAt > now() && selected.isCurrent()) {
        addOwner.run(selected.participantId);
        selected.respond(true);
        return true;
      }
      selected.respond(false);
      return false;
    },
    attach({ transport, verifyPeer, currentPeer }) {
      assertOpen();
      if (attached) throw Error('Owner pairing is already connected');
      attached = true;
      transport.onMessage(OWNER_PAIRING_REQUEST, (peer, input) => {
        void (async () => {
          if (closed || !ownerPairingRequestId(input?.requestId) || !ownerPairingCode(input?.code)
            || !transport.getPeerBinding(peer) || !offer || offer.expiresAt <= now()
            || !timingSafeEqual(Buffer.from(offer.code), Buffer.from(input.code))) return;
          const { expiresAt } = offer, { requestId } = input, issued = version;
          // Reserve the code before any asynchronous proof to prevent competing claims.
          offer = null;
          const participantId = await verifyPeer(peer, AbortSignal.timeout(5000));
          const isCurrent = () => !closed && issued === version && currentPeer(peer) === participantId;
          if (!ownerParticipantId(participantId) || !isCurrent() || expiresAt <= now()) return;
          const respond = approved => {
            if (isCurrent()) transport.sendToPeer(peer, OWNER_PAIRING_RESULT, { requestId, approved });
          };
          pending = { requestId, participantId, expiresAt, isCurrent, respond };
          onRequest({ requestId, participantId, expiresAt });
        })().catch(() => {});
      });
    },
    close() {
      if (closed) return;
      clearPending();
      closed = true;
      offer = null;
      db.close();
    }
  });
}
