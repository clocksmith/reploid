// "Run a model" on the host's run controller with the peer run session replaced: what the page states comes from the
// host's decisions, consent is required before a sequence leaves, and each recovery choice does what the vanilla page did.
// No real network, contributor or model execution.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import type { AskServices } from '../../apps/poolday-react/src/features/ask/domain/ask';
import { AskPage } from '../../apps/poolday-react/src/features/ask/presentation/AskPage';

const session = vi.hoisted(() => ({ run: vi.fn(), close: vi.fn() }));
vi.mock('../../apps/poolday/host/peer-run-session.js', async (original) => ({
  ...(await original<object>()),
  createPeerRunSession: () => ({ requesterIdentity: { identityRootId: 'requester:test' }, run: session.run, close: session.close }),
}));

const { createAskController } = await import('../../apps/poolday/host/decisions/ask.js');
const { resetPoolLedgerStore } = await import('../../apps/poolday/ui/pool-home/ledger-store.js');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  session.run.mockReset();
  resetPoolLedgerStore();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = () => {
  const controller = createAskController({ emit: () => undefined });
  const services = { ...controller, copyEmbedding: () => void controller.copyEmbedding() } as unknown as AskServices;
  render(
    <PooldayRoot>
      <AskPage services={services} />
    </PooldayRoot>,
  );
  return controller;
};
const surface = () => document.querySelector('[data-pool-run-surface="run"]') as HTMLElement;
const status = () => document.querySelector('[data-pool-run-status]')?.textContent;
const consent = () => document.querySelector('[data-pool-run-sequence-public]') as HTMLElement;

describe('Run a model', () => {
  it('starts ready with the launch sequence, model facts and verification choices', async () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Run a model', level: 1 })).toBeTruthy();
    expect((document.querySelector('[data-pool-run-prompt]') as HTMLTextAreaElement).value).toBe('MAPLALLLLGLVAGA');
    expect(status()).toBe('Ready');
    expect(surface().dataset.runState).toBe('idle');
    expect(document.querySelector('[data-pool-run-workload]')?.textContent).toBe('sequence.embedding.v1');
    expect(within(document.querySelector('[data-pool-run-policy]') as HTMLElement).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value))
      .toEqual(['fastest_receipt', 'canary_audited', 'redundant_agreement', 'ring_quorum_receipt']);
    expect(screen.getByText('Peer quorum')).toBeTruthy();
    expect(document.querySelector('[data-pool-run-output]')).toBeNull();
  });

  it('refuses to send a sequence that was not confirmed public', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await vi.waitFor(() => expect(status()).toBe('Run needs attention'));
    expect(session.run).not.toHaveBeenCalled();
    expect(document.querySelector('[data-pool-run-result-raw]')?.textContent).toContain('sequence_public_consent_required');
  });

  it('runs a confirmed public sequence, shows the verified answer and remembers the consent', async () => {
    session.run.mockResolvedValue({ status: 'completed', transport: 'webrtc_peer_room', outputText: 'e2e:MAPLA', receiptHash: 'sha256:abc',
      agreement: { accepted: true, acceptedProviderCount: 1, requiredAgreement: 1 }, policyId: 'fastest_receipt' });
    mount();
    await userEvent.click(consent());
    expect(consent().getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await vi.waitFor(() => expect(status()).toBe('Protein embedding verified'));
    expect(surface().dataset.runState).toBe('complete');
    expect(document.querySelector('[data-pool-run-result-stream]')?.textContent).toBe('e2e:MAPLA');
    expect(session.run.mock.calls[0][0]).toMatchObject({ lane: 'sequence', sequence: 'MAPLALLLLGLVAGA', policyId: 'fastest_receipt' });
    expect(localStorage.getItem('reploid.pool.sequence-public-consent.v1')).toBe('true');
    expect(within(document.querySelector('[data-pool-run-result-evidence]') as HTMLElement).getByText('1/1 matched')).toBeTruthy();
  });

  it('offers recovery when no contributor answers, and runs here only after its own consent step', async () => {
    const missing = Object.assign(new Error('No provider'), { code: 'peer_provider_not_found' });
    session.run.mockRejectedValueOnce(missing).mockResolvedValueOnce({ status: 'completed', transport: 'local_capsule', outputText: 'local answer' });
    mount();
    await userEvent.click(consent());
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await vi.waitFor(() => expect(status()).toBe('No matching provider is currently available'));
    const recovery = () => document.querySelector('[data-pool-run-result-recovery]') as HTMLElement;
    expect(recovery().dataset.poolRunRecoveryKind).toBe('provider_missing');
    expect(document.querySelector('[data-pool-run-result-stream]')).toBeNull();
    expect(document.querySelector('[data-pool-run-recovery-action="invite_contributor"]')?.getAttribute('href')).toContain('room=');
    await userEvent.click(within(recovery()).getByRole('button', { name: 'Run on this device' }));
    expect(recovery().dataset.poolRunRecoveryKind).toBe('local_provider_consent');
    expect(session.run).toHaveBeenCalledTimes(1);
    await userEvent.click(within(recovery()).getByRole('button', { name: 'Download and run here' }));
    await vi.waitFor(() => expect(status()).toBe('Completed on this device'));
    expect(session.run.mock.calls[1][0]).toMatchObject({ localExecution: true, sequence: 'MAPLALLLLGLVAGA' });
  });

  it('restores an interrupted request after a reload, and discards it only on request', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' }] as unknown as PerformanceEntryList);
    const { getPeerRoomId, getPeerRelayMode } = await import('../../apps/poolday/host/product-context.js');
    sessionStorage.setItem('reploid.pool.pending-request.v1', JSON.stringify({ version: 1, lane: 'sequence', sensitivity: 'public', sequence: 'MKTAYIAK',
      selectedModelId: 'esm2-t12-35m-ur50d-f32-af32', policyId: 'fastest_receipt', roomId: getPeerRoomId(), relay: getPeerRelayMode(), startedAt: new Date().toISOString() }));
    mount();
    expect(status()).toBe('Previous request needs a decision');
    expect((document.querySelector('[data-pool-run-prompt]') as HTMLTextAreaElement).value).toBe('MKTAYIAK');
    expect(document.querySelector('[data-pool-run-result-raw]')?.textContent).toContain('Code: peer_request_interrupted');
    expect(document.querySelector('[data-pool-run-result-recovery]')?.textContent).toContain('has not been resumed or sent again');
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(status()).toBe('Ready for a new request');
    expect(document.querySelector('[data-pool-run-output]')).toBeNull();
    expect(sessionStorage.getItem('reploid.pool.pending-request.v1')).toBeNull();
    expect(session.run).not.toHaveBeenCalled();
    await act(async () => undefined);
  });
});
