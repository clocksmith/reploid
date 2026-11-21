// @vitest-environment node
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
