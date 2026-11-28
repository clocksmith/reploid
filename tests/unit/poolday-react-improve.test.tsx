// The React Changes page (/improve) on a fixture host: what it shows comes from the host's work session and
// evolution owner through the improve controller, and each control calls the command the vanilla page called.
// No task, tool test or training runs.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import { createImproveController } from '../../apps/poolday/host/decisions/improve.js';
import { createImproveHost } from '../../apps/poolday-react/src/app/pageFixtures';
import type { ImproveServices } from '../../apps/poolday-react/src/features/improve/domain/improve';
import { createImproveServices } from '../../apps/poolday-react/src/features/improve/infrastructure/hostImprove';
import { ImprovePage } from '../../apps/poolday-react/src/features/improve/presentation/ImprovePage';

afterEach(() => cleanup());

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

function mount(host: object) {
  const services: ImproveServices = createImproveServices({ host });
  const view = render(
    <PooldayRoot>
      <ImprovePage services={services} />
    </PooldayRoot>,
  );
  return { services, ...view };
}

describe('Changes page', () => {
  it('shows a new visitor no attempts, no result and no tool changes', async () => {
    const { container } = mount(createImproveHost({ empty: true }));
    await flush();
    expect(screen.getByRole('heading', { name: 'Changes', level: 1 })).toBeTruthy();
    expect(container.querySelector('[data-work-history]')).toBeNull();
    expect(container.querySelector('[data-work-output]')).toBeNull();
    expect(container.querySelector('[data-improvement-empty]')?.textContent).toBe('No tool changes yet.');
  });

  it('keeps attempts in cards, newest first, and opens one only on selection', async () => {
    const host = createImproveHost();
    const select = vi.spyOn(host.work, 'select');
    const { container } = mount(host);
    await flush();
    const cards = [...container.querySelectorAll('[data-work-history] [data-change-card]')] as HTMLElement[];
    expect(cards.map((card) => within(card).getAllByRole('button')[0].textContent)).toEqual(['Summarize the release notes, naming the new route', 'Summarize the release notes']);
    expect(cards[0].textContent).toContain('failed');
    expect(cards[0].textContent).toContain('The contributor disconnected.');
    expect(cards[1].textContent).toContain('Ready to review');
    expect(container.querySelector('[data-change-inspection]')).toBeNull();
    await userEvent.click(within(cards[0]).getByRole('button', { name: 'Summarize the release notes, naming the new route' }));
    expect(select).toHaveBeenCalledWith('attempt-2');
    const inspection = container.querySelector('[data-change-inspection]') as HTMLElement;
    expect(inspection).toBeTruthy();
    expect(inspection.querySelector('[data-work-result-error]')?.textContent).toBe('The contributor disconnected.');
    // The failed revision is compared with the attempt it revised.
    expect(inspection.querySelector('[data-work-parent-feedback]')?.textContent).toBe('Requested change: Name the new route.');
    expect(inspection.querySelector('[data-work-parent-output]')?.textContent).toBe('Three fixes and one new route. Nothing needs action.');
    expect(within(inspection).getByText('read_file / failed: Connection closed')).toBeTruthy();
    // A failed attempt has no result to review.
    expect(inspection.querySelector('[data-work-review-actions]')).toBeNull();
  });

  it('starts fresh and only resumes a selected checkpoint through either training button', async () => {
    const user = userEvent.setup();
    let step = 0;
    const candidate = () => ({ manifest: { id: 'my-qwen-adapter', metadata: { checkpointStep: step } } });
    const run = vi.fn(async (input: { consent: boolean; resume: boolean }) => {
      if (!input.consent) throw new Error('Approve training on the selected data first');
      step = input.resume ? step + 1 : 1;
      return candidate();
    });
    const training = { getState: () => ({ phase: 'idle', busy: false }), getCandidate: () => null,
      policy: { maxInputBytes: 256 }, run, connect: async () => {}, peers: () => [{ id: 'peer-a', name: 'Contributor A' }] };
    const { services } = mount({ ...createImproveHost(), training });
    await user.click(screen.getByText('Train a LoRA adapter'));
    act(() => services.chooseSamples(new File(['[{"inputIds":[1],"targetIds":[2],"supervisedTokenCount":1}]'], 'one.json')));
    await flush();
    const resume = () => screen.queryByRole('switch', { name: 'Continue from last checkpoint' });
    expect(resume()).toBeNull();
    const consent = screen.getByRole('switch', { name: 'Allow model preparation and training' });
    expect(consent.getAttribute('aria-checked')).toBe('false');
    await user.click(consent);
    const local = screen.getByRole('button', { name: 'Train on this device' });
    await user.click(local);
    expect(run.mock.lastCall?.[0]).toMatchObject({ consent: true, peers: [], resume: false, retainCheckpoint: true });
    expect(resume()?.getAttribute('aria-checked')).toBe('false');
    await user.click(resume()!);
    await user.click(local);
    expect(run.mock.lastCall?.[0]).toMatchObject({ consent: true, peers: [], resume: true, retainCheckpoint: true });
    expect(screen.getByText('my-qwen-adapter · step 2')).toBeTruthy();
    expect(resume()?.getAttribute('aria-checked')).toBe('false');
    await user.click(screen.getByText('Train with connected participants'));
    await user.click(screen.getByRole('button', { name: 'Connect training' }));
    await user.click(screen.getByRole('checkbox', { name: 'Contributor A' }));
    const pooled = screen.getByRole('button', { name: 'Train with selected participants' });
    await user.click(pooled);
    expect(run.mock.lastCall?.[0]).toMatchObject({ peers: ['peer-a'], resume: false, retainCheckpoint: true });
    await user.click(resume()!);
    await user.click(consent);
    await user.click(pooled);
    expect(run.mock.lastCall?.[0]).toMatchObject({ consent: false, peers: ['peer-a'], resume: true, retainCheckpoint: true });
    expect(screen.getByText('Approve training on the selected data first')).toBeTruthy();
    expect(screen.getByText('my-qwen-adapter · step 1')).toBeTruthy();
    expect(resume()?.getAttribute('aria-checked')).toBe('false');
    await user.click(consent);
    await user.click(resume()!);
    await user.click(pooled);
    expect(run.mock.lastCall?.[0]).toMatchObject({ consent: true, peers: ['peer-a'], resume: true, retainCheckpoint: true });
    expect(screen.getByText('my-qwen-adapter · step 2')).toBeTruthy();
  });

  it('reviews a delivered result through the work session', async () => {
    const host = createImproveHost();
    const review = vi.spyOn(host.work, 'review');
    const { container, services } = mount(host);
    await flush();
    act(() => services.select('attempt-1'));
    await flush();
    const inspection = container.querySelector('[data-change-inspection]') as HTMLElement;
    expect(inspection.querySelector('[data-work-answer]')?.textContent).toBe('Three fixes and one new route. Nothing needs action.');
    expect(inspection.querySelector('[data-work-review-status]')?.textContent).toBe('Accepted by you');
    expect(inspection.querySelector('[data-work-result-criteria]')?.textContent).toBe('Success criteria: Under 40 words, names every change.');
    await userEvent.click(within(inspection).getByRole('button', { name: 'Needs changes' }));
    await flush();
    expect(review).toHaveBeenCalledWith('attempt-1', false);
    expect(inspection.querySelector('[data-work-review-status]')?.textContent).toBe('Changes requested');
  });

  it('states a tested candidate and records the person\'s decision', async () => {
    const host = createImproveHost();
    const decide = vi.spyOn(host.evolution, 'decide');
    const { container } = mount(host);
    await flush();
    const candidate = container.querySelector('[data-work-candidate="candidate-1"]') as HTMLElement;
    expect(candidate.textContent).toContain('Tested · approval needed');
    expect(candidate.textContent).toContain('Current: 4/5 checks. Candidate: 5/5 checks.');
    expect(within(candidate).getByRole('button', { name: 'From task: Summarize the release notes' })).toBeTruthy();
    await userEvent.click(within(candidate).getByRole('button', { name: 'Use this version' }));
    await flush();
    expect(decide).toHaveBeenCalledWith('candidate-1', true);
    expect(container.querySelector('[data-experiment-status]')?.textContent).toBe('New tasks will use this version. The previous version is retained.');
  });
});

describe('improve controller', () => {
  it('refuses a tool decision while a task runs', async () => {
    const host = createImproveHost();
    (host.work.getState() as { busy: boolean }).busy = true;
    const decide = vi.spyOn(host.evolution, 'decide');
    const controller = createImproveController(host);
    await controller.decide('candidate-1', true);
    expect(decide).not.toHaveBeenCalled();
    expect(controller.getSnapshot().tools?.status).toBe('Wait for the task to finish before changing its tools');
    controller.dispose();
  });

  it('checks training samples before any run', async () => {
    const run = vi.fn();
    const training = { getState: () => ({ phase: 'idle', busy: false }), subscribe: () => () => undefined, getCandidate: () => null, policy: { maxInputBytes: 64 }, run };
    const controller = createImproveController({ training });
    await controller.trainHere();
    expect(controller.getSnapshot().training?.error).toBe('Choose training samples first');
    await controller.chooseSamples(new File(['{"samples": []}'], 'samples.json'));
    expect(controller.getSnapshot().training?.error).toBe('Choose a JSON array of tokenized training samples');
    await controller.chooseSamples(new File(['x'.repeat(65)], 'big.json'));
    expect(controller.getSnapshot().training?.error).toBe('Training file exceeds the input allowance');
    await controller.chooseSamples(new File(['[{"inputIds":[1]}]'], 'one.json'));
    expect(controller.getSnapshot().training?.status).toBe('1 training samples selected');
    expect(run).not.toHaveBeenCalled();
    controller.dispose();
  });
});
