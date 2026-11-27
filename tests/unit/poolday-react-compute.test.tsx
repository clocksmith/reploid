// "Sequence provider" on the host's contribution controller with the contribution session replaced: what the page
// states comes from the session's own ports, as the vanilla page's did, and each control calls the session command
// the vanilla page called. No real network, model load or contribution.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import type { ComputeServices } from '../../apps/poolday-react/src/features/compute/domain/compute';
import { ComputePage } from '../../apps/poolday-react/src/features/compute/presentation/ComputePage';

type Ports = Record<string, (...args: never[]) => unknown>;
const fake = vi.hoisted(() => ({
  ports: null as unknown as Record<string, (...args: unknown[]) => unknown>,
  session: { attach: vi.fn(), resume: vi.fn(), toggle: vi.fn(), handleModelChange: vi.fn(), applyParticipationPreferences: vi.fn(async () => undefined), dispose: vi.fn(async () => undefined) },
}));
vi.mock('../../apps/poolday/host/provider-contribution-session.js', () => ({
  createProviderContributionSession: (ports: Ports) => {
    fake.ports = ports as unknown as typeof fake.ports;
    return fake.session;
  },
}));

const { createComputeController } = await import('../../apps/poolday/host/decisions/compute.js');

beforeEach(() => {
  localStorage.clear();
  for (const command of Object.values(fake.session)) command.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mount = () => {
  const controller = createComputeController({ href: () => 'http://localhost/compute?room=compute-room' });
  const services = { ...controller, enrollPasskey: () => void controller.enrollPasskey() } as unknown as ComputeServices;
  render(
    <PooldayRoot>
      <ComputePage services={services} />
    </PooldayRoot>,
  );
  return controller;
};
const status = () => document.querySelector('[data-pool-provider-status]') as HTMLElement;
const toggle = () => document.querySelector('[data-pool-provider-worker-toggle]') as HTMLButtonElement;

describe('Sequence provider', () => {
  it('starts idle, attached to the session, with the sharing boundary and limits it will honour', () => {
    mount();
    expect(fake.session.attach).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Sequence provider', level: 1 })).toBeTruthy();
    expect(status().textContent).toBe('Idle');
    expect(status().dataset.providerState).toBe('offline');
    expect(toggle().textContent).toBe('Start sharing');
    expect(toggle().dataset.contributionAction).toBe('start');
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Before you share')).toBeTruthy();
    expect(screen.getByText('Share until you stop or close this tab')).toBeTruthy();
    expect(document.querySelector('[data-pool-provider-result]')?.textContent).toBe('No activity yet.');
    expect(document.querySelector('[data-pool-provider-details]')?.hasAttribute('open')).toBe(false);
    expect(document.querySelector('[data-pool-contribution-history]')).toBeNull();
  });

  it('shows the state the session reports through its ports, and the button follows it', async () => {
    mount();
    await userEvent.click(toggle());
    expect(fake.session.toggle).toHaveBeenCalledTimes(1);
    act(() => {
      fake.ports.renderControls({ workerRunning: false, workerStarting: true });
      fake.ports.setProviderStatus('Starting');
    });
    expect(toggle().textContent).toBe('Starting...');
    expect(toggle().disabled).toBe(true);
    expect(status().dataset.providerState).toBe('starting');
    act(() => {
      fake.ports.renderControls({ workerRunning: true, workerStarting: false });
      fake.ports.setProviderStatus('Available');
      fake.ports.setResult('pool-provider-result', { runner: 'peer_room_listening', relay: 'local' });
    });
    expect(toggle().textContent).toBe('Stop sharing');
    expect(toggle().dataset.contributionAction).toBe('stop');
    expect(status().dataset.providerState).toBe('online');
    expect(document.querySelector('[data-pool-provider-result-raw]')?.textContent).toContain('peer_room_listening');
    expect((within(document.querySelector('[data-pool-provider-model]') as HTMLElement).getAllByRole('radio')[0] as HTMLInputElement).disabled).toBe(true);
    act(() => fake.ports.setProviderStatus('Relay unavailable'));
    expect(status().dataset.providerState).toBe('degraded');
  });

  it('states a failed start as a notice, with nothing shared', () => {
    mount();
    act(() => {
      fake.ports.setProviderStatus('Could not start');
      fake.ports.setProviderNotice({ state: 'error', title: 'Model failed to load', message: 'Nothing was shared.' });
      fake.ports.updateProviderHealth({ model: 'load_failed', queue: 'stopped' });
    });
    expect(status().dataset.providerState).toBe('error');
    expect(document.querySelector('[data-pool-provider-notice]')?.textContent).toContain('Model failed to load');
    expect(document.querySelector('[data-pool-provider-notice]')?.textContent).toContain('Nothing was shared');
    expect(within(document.querySelector('[data-pool-provider-health]') as HTMLElement).getByText('load failed')).toBeTruthy();
  });

  it('saves a sharing limit at once and restarts sharing under it only after the person pauses', async () => {
    mount();
    const field = document.querySelector('[data-pool-limit="maxConcurrentJobs"]') as HTMLInputElement;
    vi.useFakeTimers();
    act(() => {
      field.focus();
    });
    await act(async () => {
      const { fireEvent } = await import('@testing-library/react');
      fireEvent.change(field, { target: { value: '9' } });
      fireEvent.change(field, { target: { value: '2' } });
    });
    expect(JSON.parse(localStorage.getItem('reploid.pool.participation.v1') || '{}').limits.maxConcurrentJobs).toBe(2);
    expect(fake.session.applyParticipationPreferences).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(fake.session.applyParticipationPreferences).toHaveBeenCalledTimes(1);
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('records completed work in the recent receipts', () => {
    mount();
    act(() => {
      fake.ports.updateContributionState({ state: 'idle', optedIn: true, modelId: 'esm2-t12-35m-ur50d-f32-af32' });
      fake.ports.recordContributionReceipt({ receiptHash: 'sha256:feedface', receipt: { tokenCounts: { input: 12 } }, roomId: 'compute-room' }, { modelId: 'esm2-t12-35m-ur50d-f32-af32', roomId: 'compute-room' });
    });
    expect(document.querySelector('[data-pool-contribution-history]')).toBeTruthy();
    expect(document.querySelector('[data-pool-provider-node-stats]')?.textContent).toContain('24h receipts');
  });
});
