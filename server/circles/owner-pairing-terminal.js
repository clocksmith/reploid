import { renderQrForTerminal } from '../terminal-qr.js';

/**
 * Fragment-only link: the code never reaches a web server log. It carries no computer name: the host's name is
 * private to its owner, and the phone names the computer generically ("your desktop").
 */
export function ownerPairingLink({ code, hostParticipantId, room }) {
  const params = new URLSearchParams({ pair: code, host: hostParticipantId });
  if (room) params.set('room', room);
  return `https://replo.id/#${params.toString()}`;
}

/**
 * Fragment-only guest link: one device, bounded messages; the token never reaches a web server log. A guest is a
 * stranger to this computer, so the link names it by its peer ID only, never by its host name.
 */
export function guestInviteLink({ token, hostParticipantId, room }) {
  const params = new URLSearchParams({ circle: token, host: hostParticipantId });
  if (room) params.set('room', room);
  return `https://replo.id/#${params.toString()}`;
}

export const GUEST_INVITE_DEFAULTS = Object.freeze({ hours: 24, maxRequests: 10, maxOutputTokens: 256 });

const shortPeer = participantId => participantId.length > 16 ? `${participantId.slice(0, 9)}…${participantId.slice(-4)}` : participantId;

export const ownerPairingPrompt = ({ participantId }) => `Pair phone ${shortPeer(participantId)}? [y/n]`;

/** Shorthand decisions apply only to the single request waiting when the owner presses Enter. */
export function createOwnerPairingTerminal({ pairing, invites = null, room, write = line => console.error(line), renderQr = renderQrForTerminal, now = Date.now }) {
  const activeInvites = () => (invites?.list() || []).filter(invite => invite.status === 'active');
  const describeInvite = invite => `  ${invite.inviteId.slice(0, 8)}  ${invite.guestPeerId ? `used by ${shortPeer(invite.guestPeerId)}` : 'not opened yet'}`
    + `  ${invite.usedRequests}/${invite.maxRequests} messages  until ${new Date(invite.expiresAt).toLocaleString()}`;
  const issueInvite = () => {
    const { hours, maxRequests, maxOutputTokens } = GUEST_INVITE_DEFAULTS;
    const invite = invites.issue({ expiresAt: now() + hours * 3_600_000, maxRequests, maxOutputTokens });
    const link = guestInviteLink({ token: invite.token, hostParticipantId: invite.hostPeerId, room });
    write(`Guest link (one device, ${maxRequests} messages, ${hours} hours): ${link}`);
    write(renderQr(link));
    write('Send it to one person. Their prompts run here and you can read them. Type revoke to cancel it.');
  };
  const revokeInvite = target => {
    const active = activeInvites();
    const invite = !target || target === 'last' ? active[0] : active.find(item => item.inviteId === target || item.inviteId.startsWith(target));
    if (!invite) { write(active.length ? 'No matching guest link. Type invites to list them.' : 'No active guest links.'); return; }
    invites.revoke(invite.inviteId);
    write(`Guest link ${invite.inviteId.slice(0, 8)} revoked. Waiting messages from it will not be accepted.`);
  };
  const decide = (requestId, approved) => {
    write(pairing.decide(requestId, approved) ? 'Phone paired.' : 'Pairing declined or expired.');
  };
  const listPending = pending => pending.map(({ requestId, participantId }) => `  ${requestId}  ${participantId}`).join('\n');
  const decidePending = approved => {
    const pending = pairing.pendingRequests();
    if (pending.length === 0) {
      write('No request yet. Tap Connect on your phone.');
    } else if (pending.length > 1) {
      write(`${pending.length} pairing requests are waiting. Type approve <id> or decline <id>:\n${listPending(pending)}`);
    } else {
      decide(pending[0].requestId, approved);
    }
  };
  return Object.freeze({
    handleLine(line) {
      const [word = '', requestId, extra] = line.trim().split(/\s+/);
      const command = word.toLowerCase();
      try {
        if (command === 'pair') {
          const { hostParticipantId, code } = pairing.issue();
          const link = ownerPairingLink({ code, hostParticipantId, room });
          write(`Owner pairing code for ${hostParticipantId} (one use, 10 minutes): ${code}`);
          write(`Pairing link: ${link}`);
          write(renderQr(link));
          write('Scan the code with your phone camera, or open the link on your phone. You approve the request here.');
        } else if (['y', 'yes', 'n', 'no'].includes(command) && !requestId) {
          decidePending(command.startsWith('y'));
        } else if (command === 'approve' || command === 'decline') {
          const approved = command === 'approve';
          if (extra) write(`Type ${command} with one request ID, or use y / n.`);
          else if (!requestId || ['last', 'next'].includes(requestId.toLowerCase())) decidePending(approved);
          else decide(requestId, approved);
        } else if (invites && command === 'invite') {
          issueInvite();
        } else if (invites && command === 'invites') {
          const active = activeInvites();
          write(active.length ? `Active guest links:\n${active.map(describeInvite).join('\n')}` : 'No active guest links. Type invite to create one.');
        } else if (invites && command === 'revoke') {
          revokeInvite(requestId?.toLowerCase());
        } else if (command) write(invites ? 'Type pair to connect your phone, invite to share with a guest, or revoke to cancel a guest link.'
          : 'Type pair for a code, then approve next when your phone asks.');
      } catch (error) { write(error.message); }
    }
  });
}
