import { expect, it, vi } from 'vitest';
import { createOwnerPairingUrl, parseOwnerPairingUrl } from '../../apps/poolday/host/owner-pairing.js';
import { bindOwnerPairingControls, renderOwnerPairingControls } from '../../apps/poolday/ui/pool-home/owner-pairing-view.js';

it('prefills from a fragment-only QR link without local address fields, pairs, and shows online/offline states', async () => {
  const hostParticipantId = `peer:${'a'.repeat(24)}`;
  const code = 'B'.repeat(24);
  const roomId = 'reploid-swarm-alex-pc';
  const url = createOwnerPairingUrl({ hostParticipantId, code, hostLabel: "Alex's PC", roomId }, 'https://replo.id/');
  expect(new URL(url).search).toBe('');
  expect(parseOwnerPairingUrl(url)).toEqual({
    hostParticipantId,
    code,
    hostLabel: "Alex's PC",
    roomId
  });

  document.body.innerHTML = renderOwnerPairingControls();
  const query = selector => document.querySelector(selector);
  expect(query('input[name="address"]')).toBeNull();
  expect(query('input[name="secret"]')).toBeNull();

  let currentState = { status: 'unpaired', paired: false, canSend: false, disclosure: null, error: '' };
  const ownerPairing = {
    state: () => currentState,
    pair: vi.fn(async ({ hostParticipantId: id, code: entered, hostLabel, roomId: requestedRoom }) => {
      expect(id).toBe(hostParticipantId);
      expect(entered).toBe(code);
      expect(requestedRoom).toBe(roomId);
      currentState = {
        status: 'online',
        paired: true,
        canSend: true,
        hostParticipantId: id,
        hostLabel: hostLabel || id,
        roomId: requestedRoom,
        transportPath: 'relayed',
        readyModel: 'qwen-3-5-0-8b',
        disclosure: {
          readableBy: `Readable by: ${hostLabel}`,
          notice: `This runs on ${hostLabel}. Its operator can read your prompt.`
        },
        error: ''
      };
      return { hostParticipantId: id, hostLabel, roomId: requestedRoom };
    }),
    unpair: vi.fn(() => {
      currentState = { status: 'unpaired', paired: false, canSend: false, disclosure: null, error: '' };
    })
  };
  const session = { ownerPairing, getState: () => ({ ownerPairing: currentState }) };
  const view = bindOwnerPairingControls(document, session, { initialUrl: url });

  // QR link prefilled the form including the nondefault room routing hint and opened the panel.
  expect(query('[data-owner-pairing]').open).toBe(true);
  expect(query('input[name="hostParticipantId"]').value).toBe(hostParticipantId);
  expect(query('input[name="code"]').value).toBe(code);
  expect(query('input[name="hostLabel"]').value).toBe("Alex's PC");
  expect(query('input[name="roomId"]').value).toBe(roomId);

  // Submitting requests desktop approval and displays pre-prompt disclosure + relayed path.
  query('[data-owner-pairing-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(query('[data-owner-pairing-state]').textContent).toContain('Online · relayed · qwen-3-5-0-8b'));
  expect(query('[data-owner-pairing-readable]').textContent).toBe("Readable by: Alex's PC");
  expect(query('[data-owner-pairing-notice]').textContent).toBe("This runs on Alex's PC. Its operator can read your prompt.");
  expect(query('input[name="code"]').value).toBe('');

  // When desktop goes offline, state clearly reports offline and keeps prompts off other computers.
  currentState = { ...currentState, status: 'offline', canSend: false, transportPath: null, readyModel: null };
  view.update({ ownerPairing: currentState });
  expect(query('[data-owner-pairing-state]').textContent).toContain('Offline');
  expect(query('[data-owner-pairing-state]').textContent).toContain('will not be sent to another computer');

  // Unpair clears the binding.
  query('[data-owner-pairing-unpair]').click();
  expect(ownerPairing.unpair).toHaveBeenCalledTimes(1);
  expect(query('[data-owner-pairing-state]').textContent).toBe('Not paired');
  view.dispose();
});
