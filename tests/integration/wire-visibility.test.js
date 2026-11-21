// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCircleWireFixture } from '../../scripts/verify-wire-circle-fixtures.js';
import { describe, expect, it } from 'vitest';
import { runWireVisibilityVerification } from '../../scripts/verify-wire-visibility.js';

describe('Coordinator, signaling, and UDP relay wire visibility (#189)', () => {
  it('delivers prompt and answer over DTLS WebRTC while exposing zero canary bytes to signaling, UDP relay, coordinator store, or credit ledger', async () => {
    const receipt = await runWireVisibilityVerification();
    expect(receipt.checks.signalingFramesObserved).toBeGreaterThan(0);
    expect(receipt.checks.udpRelayPacketsObserved).toBeGreaterThan(0);
    expect(receipt.checks.signalingPromptCanaryMatches).toBe(0);
    expect(receipt.checks.signalingAnswerCanaryMatches).toBe(0);
    expect(receipt.checks.udpRelayPromptCanaryMatches).toBe(0);
    expect(receipt.checks.udpRelayAnswerCanaryMatches).toBe(0);
    expect(receipt.checks.fleetHttpWireBytesObserved).toBeGreaterThan(0);
    expect(receipt.checks.fleetHttpPromptCanaryMatches).toBe(0);
    expect(receipt.checks.fleetHttpAnswerCanaryMatches).toBe(0);
    expect(receipt.checks.fleetSqlitePromptCanaryMatches).toBe(0);
    expect(receipt.checks.fleetSqliteAnswerCanaryMatches).toBe(0);
    expect(receipt.checks.coordinatorStorePromptCanaryMatches).toBe(0);
    expect(receipt.checks.coordinatorStoreAnswerCanaryMatches).toBe(0);
    expect(receipt.checks.peerRoomPromptInjectionHttpStatus).toBe(400);
    expect(receipt.checks.coordinatorPlaintextJobHttpStatus).toBe(400);
    expect(receipt.checks.servingComputerReadPrompt).toBe(true);
    expect(receipt.checks.requesterBrowserReadAnswer).toBe(true);
  });
});

const root = fileURLToPath(new URL('../..', import.meta.url));
const variants = [
  { scenario: 'invite', checkout: process.env.REPLOID_WIRE_INVITE_CHECKOUT || root,
    required: ['server/circles/invites.js', 'server/circles/admission.js'] },
  { scenario: 'reconnect', checkout: process.env.REPLOID_WIRE_PAIRING_CHECKOUT || root,
    required: ['server/circles/owner-pairing.js', 'packages/reploid/src/transport/owner-pairing.js'] }
];
for (const variant of variants) {
  const missing = variant.checkout === root && !variant.required.every(file => existsSync(path.join(root, file)));
  it.skipIf(missing)('captures the ' + variant.scenario + ' canaries on same-host WebRTC', async () => {
    const { checks, fixtureAdmission } = await runCircleWireFixture(variant);
    expect(checks).toMatchObject({
      signaling: { frames: expect.any(Number), promptMatches: 0, answerMatches: 0 },
      desktopControlStore: { bytes: expect.any(Number), promptMatches: 0, answerMatches: 0 },
      selectedTransport: 'webrtc', selectedIcePath: 'direct', iceServersConfigured: 0, cellularTested: false, admitted: 1,
      freshScope: variant.scenario === 'reconnect', staleRefused: variant.scenario === 'reconnect',
      revokedRefused: variant.scenario === 'invite'
    });
    expect(checks.endpointDataChannels.promptMatches).toBeGreaterThan(0);
    expect(checks.endpointDataChannels.answerMatches).toBeGreaterThan(0);
    if (variant.scenario === 'invite') expect(fixtureAdmission).toContain('not wired');
  }, 20000);
}
