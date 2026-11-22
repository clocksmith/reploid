import { describe, expect, it, vi } from 'vitest';
import {
  createOwnerPairingTerminal,
  ownerPairingDisplayName,
  ownerPairingLink,
  ownerPairingPrompt
} from '../../server/circles/owner-pairing-terminal.js';
import { parseOwnerPairingUrl } from '../../apps/poolday/host/owner-pairing.js';

const host = `peer:860c${'0'.repeat(16)}79cd`;
const phone = `peer:${'a'.repeat(24)}`;
const otherPhone = `peer:${'b'.repeat(24)}`;
const code = 'C'.repeat(24);
const requestId = '11111111-2222-3333-4444-555555555555';

function terminal({ pending = [], decision = true } = {}) {
  const lines = [];
  const pairing = {
    issue: vi.fn(() => ({ hostParticipantId: host, code, expiresAt: 0 })),
    pendingRequests: vi.fn(() => pending),
    decide: vi.fn(() => decision)
  };
  const commands = createOwnerPairingTerminal({ pairing, room: 'reploid-swarm-home', name: 'Mars',
    write: line => lines.push(line), renderQr: link => `QR(${link})` });
  return { lines, pairing, commands };
}

describe('owner pairing link name', () => {
  it('uses the short host name and never a domain or address', () => {
    expect(ownerPairingDisplayName('mars.local')).toBe('Mars');
    expect(ownerPairingDisplayName('alex-mbp.corp.example.com')).toBe('Alex-mbp');
    expect(ownerPairingDisplayName('10.0.0.5')).toBeNull();
    expect(ownerPairingDisplayName('fe80::1')).toBeNull();
    expect(ownerPairingDisplayName('ip-10-0-0-5.ec2.internal')).toBeNull();
    expect(ownerPairingDisplayName('')).toBeNull();
  });

  it('puts name, host, room and code in the fragment the browser parses', () => {
    const link = ownerPairingLink({ code, hostParticipantId: host, room: 'reploid-swarm-home', name: 'Mars' });
    expect(new URL(link).search).toBe('');
    expect(parseOwnerPairingUrl(link)).toEqual({ code, hostParticipantId: host, hostLabel: 'Mars', roomId: 'reploid-swarm-home' });
    expect(ownerPairingLink({ code, hostParticipantId: host, name: null })).not.toContain('name=');
  });

  it('prints the code, the named link and its QR code on pair', () => {
    const { lines, pairing, commands } = terminal();
    commands.handleLine('pair');
    expect(pairing.issue).toHaveBeenCalledTimes(1);
    const link = ownerPairingLink({ code, hostParticipantId: host, room: 'reploid-swarm-home', name: 'Mars' });
    expect(lines).toEqual([
      `Owner pairing code for ${host} (one use, 10 minutes): ${code}`,
      `Pairing link: ${link}`,
      `QR(${link})`,
      'Scan the code with your phone camera, or open the link on your phone. You approve the request here.'
    ]);
  });
});

describe('owner pairing decisions', () => {
  it('prompts with a shortened peer ID', () => {
    expect(ownerPairingPrompt({ participantId: host })).toBe('Pair phone peer:860c…79cd? [y/n]');
  });

  it.each([
    ['y', true], ['yes', true], ['Y', true], ['n', false], ['no', false], [' No ', false],
    ['approve', true], ['approve next', true], ['approve last', true], [' APPROVE NEXT ', true], ['decline', false]
  ])(
    '%j decides the single waiting request', (input, approved) => {
      const { lines, pairing, commands } = terminal({ pending: [{ requestId, participantId: phone }], decision: approved });
      commands.handleLine(input);
      expect(pairing.decide).toHaveBeenCalledWith(requestId, approved);
      expect(lines).toEqual([approved ? 'Phone paired.' : 'Pairing declined or expired.']);
    });

  it.each(['y', 'approve', 'approve next', 'approve last'])('%j does not guess between requests', command => {
    const second = '66666666-7777-8888-9999-000000000000';
    const { lines, pairing, commands } = terminal({ pending: [{ requestId, participantId: phone }, { requestId: second, participantId: otherPhone }] });
    commands.handleLine(command);
    expect(pairing.decide).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('2 pairing requests are waiting');
    expect(lines[0]).toContain(`${requestId}  ${phone}`);
    expect(lines[0]).toContain(`${second}  ${otherPhone}`);
  });

  it('says so when nothing is waiting', () => {
    const { lines, pairing, commands } = terminal();
    commands.handleLine('approve next');
    expect(pairing.decide).not.toHaveBeenCalled();
    expect(lines).toEqual(['No request yet. Tap Connect on your phone.']);
  });

  it('does not approve when extra text follows the command', () => {
    const { pairing, commands } = terminal({ pending: [{ requestId, participantId: phone }] });
    commands.handleLine('approve next please');
    commands.handleLine('y pasted text');
    expect(pairing.decide).not.toHaveBeenCalled();
  });

  it('keeps approve <id> and decline <id> for scripts and reports helper errors', () => {
    const { lines, pairing, commands } = terminal();
    commands.handleLine(`approve ${requestId}`);
    commands.handleLine(`decline ${requestId}`);
    expect(pairing.decide.mock.calls).toEqual([[requestId, true], [requestId, false]]);
    pairing.decide.mockImplementation(() => { throw Error('No matching owner pairing request'); });
    commands.handleLine('approve wrong-id');
    commands.handleLine('approve');
    expect(lines.slice(2)).toEqual(['No matching owner pairing request',
      'No request yet. Tap Connect on your phone.']);
  });
});

describe('guest invites from the desktop terminal', () => {
  const invite = (overrides = {}) => ({ inviteId: '9a8b7c6d-0000-4000-8000-000000000001', hostPeerId: host, token: 'T'.repeat(43),
    guestPeerId: null, usedRequests: 0, maxRequests: 10, maxOutputTokens: 256, expiresAt: 10 * 3_600_000, status: 'active', ...overrides });
  function guestTerminal(list = []) {
    const lines = [];
    const invites = { issue: vi.fn(options => invite({ expiresAt: options.expiresAt })), list: vi.fn(() => list), revoke: vi.fn() };
    const pairing = { issue: vi.fn(), pendingRequests: vi.fn(() => []), decide: vi.fn() };
    const commands = createOwnerPairingTerminal({ pairing, invites, room: 'reploid-swarm-home', name: 'Mars',
      write: line => lines.push(line), renderQr: link => `QR(${link})`, now: () => 0 });
    return { lines, invites, commands };
  }

  it('issues one bounded invite and prints a fragment-only link with host, room, name and a QR code', () => {
    const t = guestTerminal();
    t.commands.handleLine('invite');
    expect(t.invites.issue).toHaveBeenCalledWith({ expiresAt: 24 * 3_600_000, maxRequests: 10, maxOutputTokens: 256 });
    const link = t.lines[0].match(/https:\/\/replo\.id\/#\S+/)[0];
    const fragment = new URLSearchParams(new URL(link).hash.slice(1));
    expect(new URL(link).search).toBe('');
    expect(Object.fromEntries(fragment)).toEqual({ circle: 'T'.repeat(43), host, room: 'reploid-swarm-home', name: 'Mars' });
    expect(t.lines[1]).toBe(`QR(${link})`);
    expect(t.lines[2]).toMatch(/can read them/);
  });

  it('lists active links and revokes the newest one or a named prefix', () => {
    const newest = invite({ inviteId: 'aaaaaaaa-0000-4000-8000-000000000002', guestPeerId: phone, usedRequests: 3 });
    const older = invite({ inviteId: 'bbbbbbbb-0000-4000-8000-000000000003' });
    const t = guestTerminal([newest, older, invite({ inviteId: 'cccccccc-0000-4000-8000-000000000004', status: 'revoked' })]);
    t.commands.handleLine('invites');
    expect(t.lines.at(-1)).toMatch(/aaaaaaaa {2}used by peer:aaaa…aaaa {2}3\/10 messages/);
    expect(t.lines.at(-1)).not.toMatch(/cccccccc/);
    t.commands.handleLine('revoke');
    expect(t.invites.revoke).toHaveBeenLastCalledWith(newest.inviteId);
    t.commands.handleLine('revoke bbbb');
    expect(t.invites.revoke).toHaveBeenLastCalledWith(older.inviteId);
    t.commands.handleLine('revoke zzzz');
    expect(t.lines.at(-1)).toMatch(/No matching guest link/);
  });

  it('keeps guest commands off a host without an invite store', () => {
    const { lines, commands } = terminal();
    commands.handleLine('invite');
    expect(lines.at(-1)).toMatch(/Type pair/);
  });
});
