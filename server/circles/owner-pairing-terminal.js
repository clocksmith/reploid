import { renderQrForTerminal } from '../terminal-qr.js';

/**
 * The desktop label carried in the pairing link: the short host name only. Full domain names, IP addresses and
 * cloud names that spell out an address (ip-10-0-0-5) are left out, and the phone then shows the peer ID instead.
 */
export function ownerPairingDisplayName(host) {
  const label = String(host ?? '').split('.')[0];
  if (!/^[A-Za-z0-9-]{1,63}$/.test(label) || !/[A-Za-z]/.test(label) || /\d+-\d+-\d+-\d+/.test(label)) return null;
  return label[0].toUpperCase() + label.slice(1);
}

/** Fragment-only link: the code never reaches a web server log. */
export function ownerPairingLink({ code, hostParticipantId, room, name }) {
  const params = new URLSearchParams({ pair: code, host: hostParticipantId });
  if (room) params.set('room', room);
  if (name) params.set('name', name);
  return `https://replo.id/#${params.toString()}`;
}

const shortPeer = participantId => participantId.length > 16 ? `${participantId.slice(0, 9)}…${participantId.slice(-4)}` : participantId;

export const ownerPairingPrompt = ({ participantId }) => `Pair phone ${shortPeer(participantId)}? [y/n]`;

/** Desktop terminal commands: pair, y/yes, n/no, and approve <id> / decline <id> for scripts. */
export function createOwnerPairingTerminal({ pairing, room, name, write = line => console.error(line), renderQr = renderQrForTerminal }) {
  const decide = (requestId, approved) => {
    write(pairing.decide(requestId, approved) ? 'Phone paired.' : 'Pairing declined or expired.');
  };
  const listPending = pending => pending.map(({ requestId, participantId }) => `  ${requestId}  ${participantId}`).join('\n');
  return Object.freeze({
    handleLine(line) {
      const [word = '', requestId] = line.trim().split(/\s+/);
      const command = word.toLowerCase();
      try {
        if (command === 'pair') {
          const { hostParticipantId, code } = pairing.issue();
          const link = ownerPairingLink({ code, hostParticipantId, room, name });
          write(`Owner pairing code for ${hostParticipantId} (one use, 10 minutes): ${code}`);
          write(`Pairing link: ${link}`);
          write(renderQr(link));
          write('Scan the code with your phone camera, or open the link on your phone. You approve the request here.');
        } else if (['y', 'yes', 'n', 'no'].includes(command)) {
          const pending = pairing.pendingRequests();
          if (pending.length === 0) write('No pairing request is waiting. Type pair to issue a code.');
          else if (pending.length > 1) {
            write(`${pending.length} pairing requests are waiting. Type approve <id> or decline <id>:\n${listPending(pending)}`);
          } else decide(pending[0].requestId, command.startsWith('y'));
        } else if (command === 'approve' || command === 'decline') {
          if (!requestId) write(`Type ${command} followed by a request ID, or y / n when one request is waiting.`);
          else decide(requestId, command === 'approve');
        } else if (command) write('Type pair to issue a code, then y or n when your phone asks.');
      } catch (error) { write(error.message); }
    }
  });
}
