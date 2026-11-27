// The React Experiments page (/experiments) on a fixture host: set-up and consent come from the research plugin
// service, judging is blind, and an early export asks first. No model runs; the study session is a fixture.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import { createExperimentsController } from '../../apps/poolday/host/decisions/experiments.js';
import { createExperimentsHost } from '../../apps/poolday-react/src/app/pageFixtures';
import type { ExperimentsServices } from '../../apps/poolday-react/src/features/experiments/domain/experiments';
import { ExperimentsPage } from '../../apps/poolday-react/src/features/experiments/presentation/ExperimentsPage';

afterEach(() => cleanup());

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const locks = { request: (_name: string, _options: object, task: (lock: object) => Promise<void>) => task({}) };
const memoryStorage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) }; };

function judgingSession() {
  const listeners = new Set<() => void>();
  let content: Record<string, unknown> = { phase: 'judging', round: 1, total: 4, prompt: 'What is 17 × 3?', canFollowup: true, answers: [['51'], ['51.']] };
  const session = {
    view: () => ({ content, status: 'ready', busy: false, sessionId: 's1' }),
    subscribe: (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn)),
    dispatch: vi.fn(async (action: { type: string }) => {
      if (action.type === 'judge') content = { phase: 'complete', results: [{ task: 'arithmetic', condition: 'imitation', judgment: { choice: 'A' }, actual: 'A', correct: true }] };
      listeners.forEach((fn) => fn());
    }),
    cancel: vi.fn(),
    close: vi.fn(async () => undefined),
    export: () => ({ sessionId: 's1' }),
  };
  return session;
}

function mount(session = judgingSession()) {
  const create = vi.fn(async () => session);
  const controller = createExperimentsController(createExperimentsHost(), {
    storage: memoryStorage(),
    locks,
    createService: (ports: { chat: unknown; swarm: unknown; storage: unknown }) => {
      // The real service's catalog and recipient review, with a fixture study session.
      const host = ports as unknown as ReturnType<typeof createExperimentsHost>;
      const models = host.chat.getState().models;
      return { models: () => models, recipients: (model: { id: string }) => host.swarm.getState().consumer.peers.filter((peer) => peer.model === model.id).map((peer) => peer.participantId), create, restore: async () => null };
    },
  });
  const exported = vi.fn();
  const services = { ...controller, exportRecord: exported } as unknown as ExperimentsServices;
  const view = render(
    <PooldayRoot>
      <ExperimentsPage services={services} />
    </PooldayRoot>,
  );
  return { create, session, exported, ...view };
}

describe('Experiments page', () => {
  it('names the recipients before consent, then judges blind and reports the result', async () => {
    const { create, session, container } = mount();
    await flush();
    expect(screen.getByRole('heading', { name: 'Spot the imitation', level: 1 })).toBeTruthy();
    await userEvent.click(screen.getByText('Connected recipients'));
    expect(screen.getByText('Qwen 3.5 0.8B: participant-1')).toBeTruthy();
    expect(screen.getByText('Qwen 3.8 27B: participant-2')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Allow and start' }));
    await flush();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'qwen-3-5-0-8b-q4k-ef16-af32-vf16', imitatorId: 'qwen-3-8-27b-text-q4k-ef16-af32', approved: true }));
    expect(session.dispatch).toHaveBeenCalledWith({ type: 'start' });
    expect(screen.getByText('Round 1 of 4')).toBeTruthy();
    const answers = [...container.querySelectorAll('[data-study-answer]')].map((card) => card.getAttribute('data-study-answer'));
    expect(answers).toEqual(['A', 'B']);
    // Judging needs a choice.
    await userEvent.click(screen.getByRole('button', { name: 'Record judgment' }));
    expect(container.querySelector('[data-study-error]')?.textContent).toBe('Choose A, B, both target, or unsure.');
    await userEvent.click(screen.getByRole('radio', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record judgment' }));
    await flush();
    expect(session.dispatch).toHaveBeenLastCalledWith({ type: 'judge', choice: 'A', confidence: 50 });
    expect(screen.getByText('1/1 imitation rounds identified.')).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'Study results' })).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['arithmetic', 'imitation', 'A', 'A']);
  });

  it('asks before an export that would break blinding', async () => {
    const { exported } = mount();
    await flush();
    await userEvent.click(screen.getByRole('button', { name: 'Allow and start' }));
    await flush();
    await userEvent.click(screen.getByRole('button', { name: 'Export private record' }));
    expect(exported).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Export before the study ends?' });
    expect(within(dialog).getByText(/Exporting now breaks blinding/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Export and break blinding' }));
    expect(exported).toHaveBeenCalledTimes(1);
  });

  it('refuses to start in a second tab', async () => {
    const controller = createExperimentsController(createExperimentsHost(), {
      storage: memoryStorage(),
      locks: { request: (_n: string, _o: object, task: (lock: null) => Promise<void>) => task(null) },
    });
    await flush();
    const view = controller.getSnapshot();
    expect(view.error).toBe('Research is already open in another tab.');
    expect(view.phase === 'setup' && view.canStart).toBe(false);
    controller.dispose();
  });
});
