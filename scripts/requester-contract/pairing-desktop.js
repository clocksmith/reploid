/**
 * The owner-desktop side of pairing for the conformance providers.
 *
 * It is the real pairing store (server/circles/owner-pairing.js): real codes,
 * real expiry, real single use, the real list of paired phones. The one thing
 * a fixture has to stand in for is the person at the desktop, who normally
 * types "pair" and then "y" or "n": here the code is issued at start and the
 * answer is fixed by an option.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ownerPairingRoomMarker } from '../../packages/reploid/src/transport/index.js';
import { openOwnerPairing } from '../../server/circles/owner-pairing.js';
import { ownerPairingLink, ownerPairingPrompt } from '../../server/circles/owner-pairing-terminal.js';

/**
 * options:
 *   expired               the code is already past its ten minutes when it is issued
 *   decline               the owner answers no
 *   forgetAfterRequests   after this many answered requests the pairing state is deleted, the only
 *                         way the current code drops a paired phone; later requests are refused
 */
export async function openPairingDesktop({ identity, roomId, label, expired = false, decline = false, forgetAfterRequests = null, log = () => {} }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-conformance-pairing-'));
  const clock = { offset: 0 };
  let generation = 0, attached = null, forgotten = false, answered = 0, closed = false;
  const open = () => {
    let store = null;
    return openOwnerPairing({ file: path.join(directory, `owner-pairing-${++generation}.sqlite`), hostParticipantId: identity.peerId,
      now: () => Date.now() + clock.offset,
      onRequest: request => {
        log(`${ownerPairingPrompt(request)} ${decline ? 'n' : 'y'}`);
        // The owner answers a moment after the prompt appears.
        setImmediate(() => { try { log(store.decide(request.requestId, !decline) ? 'Phone paired.' : 'Pairing declined or expired.'); } catch (error) { log(error.message); } });
      } }).then(opened => store = opened);
  };
  let current = await open();
  const forget = async () => {
    forgotten = true;
    log('Pairing state deleted: no phone is paired any more.');
    current.close();
    current = await open();
    if (attached) current.attach(attached);
    forgotten = false;
  };
  return {
    roomToken: ownerPairingRoomMarker(roomId),
    /** What the native host is given as its pairing store. */
    ownerPairing: {
      hostParticipantId: identity.peerId,
      isOwner: participant => !forgotten && current.isOwner(participant),
      attach(ports) { attached = ports; current.attach(ports); }
    },
    /** Issue the one code, as the owner typing "pair" does, and describe it for the ready line. */
    issue() {
      // Ten minutes and one more: the code is issued in the past, so the real expiry check refuses it.
      clock.offset = expired ? -11 * 60 * 1000 : 0;
      const issued = current.issue();
      clock.offset = 0;
      return { link: ownerPairingLink({ code: issued.code, hostParticipantId: issued.hostParticipantId, room: roomId, name: label }),
        code: issued.code, hostParticipantId: issued.hostParticipantId, hostLabel: label, roomId, roomToken: ownerPairingRoomMarker(roomId),
        expiresAt: issued.expiresAt, expired, ownerAnswer: decline ? 'no' : 'yes', forgetAfterRequests };
    },
    /** Call when a request was answered; applies forgetAfterRequests. */
    requestAnswered() {
      if (forgetAfterRequests !== null && ++answered === forgetAfterRequests && !closed) {
        forgotten = true;
        forget().catch(error => log(`Could not delete the pairing state: ${error.message}`));
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      current.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  };
}
