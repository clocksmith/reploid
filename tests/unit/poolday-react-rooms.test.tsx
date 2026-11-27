// The React Research Room-1 on the host's room model over in-memory storage: the request keeps its unsent draft per
// room, the empty room states what the vanilla room stated, the canonical dispute explains why it cannot load, and the
// research workspace's lifecycle and review forms sign records with the vanilla builders. No coordinator, model run or network.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import { createRoomModel, roomHref } from '../../apps/poolday/host/decisions/rooms.js';
import { RoomPage } from '../../apps/poolday-react/src/features/rooms/presentation/RoomPage';
import type { RoomServices } from '../../apps/poolday-react/src/features/rooms/domain/rooms';
import { memoryStorage } from '../../apps/poolday-react/src/app/recordFixtures';
import { createSignedResearchSubmission } from '../../apps/poolday/pool/evidence-network.js';
import { appendResearchRecord, resetResearchStore } from '../../apps/poolday/ui/pool-home/research-store.js';
import { createSigningKeyPair } from '../../shared/pool/inference-receipt.js';
import { buildLaunchProviderModel } from '../../shared/pool/model-contract.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetResearchStore();
});

const mount = ({ room = 'unit-room', storage = memoryStorage(), href = 'https://reploid.invalid/room-1', publishRecord = vi.fn(async () => ({ remote: false })), retainTarget = vi.fn() } = {}) => {
  const services = createRoomModel({ storage, getRoomId: () => room, hydrate: false, href: () => href, publishRecord, retainTarget }) as unknown as RoomServices;
  const view = render(
    <PooldayRoot>
      <RoomPage services={services} />
    </PooldayRoot>,
  );
  return { services, storage, publishRecord, retainTarget, view };
};

// One signed public question in the room, as a requester in another browser would have published it.
const seedQuestion = async (roomId = 'unit-room') => {
  const keyPair = await createSigningKeyPair();
  const identity = { resolve: async () => ({ kind: 'requester', roleId: 'requester_unit', userId: 'user_unit', deviceId: 'device_unit', identityRootId: 'root_unit' }), getSigningKeyPair: async () => keyPair };
  const question = await createSignedResearchSubmission({
    identity, roomId, sequence: 'MAPLALLLLGLVAGA',
    intent: { kind: 'question', text: 'Is the signal peptide cleaved?', decisionContext: 'Catalog release', conditions: 'Public protein sequence', scope: 'Residues 1-15', exclusions: 'No function claim', desiredObservation: 'Cleavage site evidence' },
    consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
    modelContract: buildLaunchProviderModel(), policyId: 'redundant_agreement'
  });
  await appendResearchRecord(question);
  return question;
};
const form = (action: string) => document.querySelector(`[data-research-lifecycle-form][data-research-action="${action}"]`) as HTMLElement;
const field = (scope: ParentNode, name: string) => scope.querySelector(`[data-research-field="${name}"]`) as HTMLInputElement;

describe('Research Room-1', () => {
  it('shows the request with its defaults and an empty research room', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Research Room-1' })).toBeTruthy();
    expect(document.querySelector('[data-pool-room-1-request]')).toBeTruthy();
    expect((document.querySelector('[data-pool-run-prompt]') as HTMLTextAreaElement).value).toBe('MAPLALLLLGLVAGA');
    expect(screen.getByRole('switch', { name: 'This sequence is public' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Save the question and result to this room' })).toBeTruthy();
    expect(screen.getByText('Research publication is explicit and separate from ordinary model runs.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Two matching peers' })).toBeTruthy();
    const room = document.querySelector('[data-pool-research-room]')!;
    expect(room.getAttribute('data-room-id')).toBe('unit-room');
    expect(room.textContent).toContain('Ready for a question');
    expect(room.textContent).toContain('No question yet');
    expect(room.textContent).toContain('No result yet');
    expect(room.textContent).toContain('No receipt-backed result is linked to this question yet.');
    expect(room.textContent).toContain('Remembered does not mean biologically true.');
    expect(document.querySelector('[data-pool-research-sync]')!.textContent).toBe('Verifying local evidence');
    expect(document.querySelector('[data-pool-room-contextual-panel]')).toBeNull();
  });

  it('restores an emptied unsent field for the same room instead of the default', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    const first = mount({ storage });
    const prompt = document.querySelector('[data-pool-run-prompt]') as HTMLTextAreaElement;
    await user.clear(prompt);
    await user.type(document.querySelector('[data-pool-run-intent-text]') as HTMLTextAreaElement, 'Is the signal peptide cleaved?');
    first.services.dispose();
    cleanup();
    mount({ storage });
    expect((document.querySelector('[data-pool-run-prompt]') as HTMLTextAreaElement).value).toBe('');
    expect((document.querySelector('[data-pool-run-intent-text]') as HTMLTextAreaElement).value).toBe('Is the signal peptide cleaved?');
    cleanup();
    mount({ storage, room: 'another-room' });
    expect((document.querySelector('[data-pool-run-prompt]') as HTMLTextAreaElement).value).toBe('MAPLALLLLGLVAGA');
  });

  it('opens the review panel from the address and links the room roles to it', () => {
    mount({ href: 'https://reploid.invalid/room-1?room=unit-room&panel=review' });
    expect(document.querySelector('[data-pool-room-contextual-panel="review"]')!.textContent).toContain('Review evidence');
    expect(document.querySelector('[data-pool-room-panel="research"]')!.getAttribute('data-pool-room-panel-open')).toBe('true');
    expect(roomHref('/room-1', 'unit-room', 'review', 'sha256:abc')).toBe('/room-1?room=unit-room&panel=review&target=sha256%3Aabc#pool-room-review');
  });

  it('shows the canonical dispute disabled with why it cannot load, and sends nothing', async () => {
    const user = userEvent.setup();
    const { publishRecord } = mount();
    const button = document.querySelector('[data-pool-load-sample-dispute]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Load canonical dispute');
    const reason = document.querySelector('[data-pool-load-sample-dispute-reason]')!;
    expect(reason.textContent).toBe("The full sequence is longer than the 1,024-residue public limit, so this dispute can't be loaded here.");
    expect(button.getAttribute('aria-describedby')).toBe(reason.id);
    await user.click(button);
    expect(publishRecord).not.toHaveBeenCalled();
  });

  it('lists every lifecycle form and holds each until the room has the records it signs about', () => {
    mount();
    for (const action of ['prior-evidence', 'hypothesis', 'prediction', 'resolution-policy', 'candidate-action', 'adjudication-experiment', 'adjudication-evaluation', 'work-order', 'work-claim', 'outcome', 'cohort', 'evaluation', 'realized-action-value', 'revocation']) {
      expect(form(action), action).toBeTruthy();
    }
    expect((document.querySelector('[data-research-lifecycle-submit="hypothesis"]') as HTMLButtonElement).disabled).toBe(true);
    // The first-market experiment needs no prior records, as the vanilla form allowed.
    expect((document.querySelector('[data-research-lifecycle-submit="adjudication-experiment"]') as HTMLButtonElement).disabled).toBe(false);
    expect(field(form('adjudication-experiment'), 'outcomeBoundaryMode').querySelector('input:checked')!.getAttribute('value')).toBe('prospective_future');
    expect(within(field(form('hypothesis'), 'questionHash')).getByRole('radio', { name: 'No eligible records' })).toHaveProperty('disabled', true);
  });

  it('shows the prior-evidence kind fields the vanilla binding showed for each kind', async () => {
    const user = userEvent.setup();
    await seedQuestion();
    mount();
    const prior = form('prior-evidence');
    expect(prior.querySelector('[data-protein-annotation-fields]')).toBeNull();
    await user.click(within(field(prior, 'evidenceKind')).getByRole('radio', { name: 'Annotation' }));
    expect(field(form('prior-evidence'), 'ontologyNamespace').required).toBe(true);
    expect(field(form('prior-evidence'), 'ontologyLabel').required).toBe(false);
    await user.click(within(field(form('prior-evidence'), 'evidenceKind')).getByRole('radio', { name: 'Negative result' }));
    expect(form('prior-evidence').querySelector('[data-protein-annotation-fields]')).toBeNull();
    const negative = within(field(form('prior-evidence'), 'findingClassification')).getByRole('radio', { name: 'Negative' }) as HTMLInputElement;
    expect(negative.checked).toBe(true);
    expect(negative.disabled).toBe(true);
    await user.click(within(field(form('prior-evidence'), 'evidenceKind')).getByRole('radio', { name: 'Failed attempt' }));
    expect(form('prior-evidence').querySelector('[data-public-evidence-failure]')).toBeTruthy();
  });

  it('signs a hypothesis with the vanilla builder after its required fields are filled', async () => {
    const user = userEvent.setup();
    const question = await seedQuestion();
    const { publishRecord } = mount();
    const hypothesis = form('hypothesis');
    const submit = document.querySelector('[data-research-lifecycle-submit="hypothesis"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await user.click(submit);
    await waitFor(() => expect(document.querySelector('[data-research-lifecycle-status="hypothesis"]')!.textContent).toBe('Complete "Hypothesis" before signing.'));
    expect(publishRecord).not.toHaveBeenCalled();
    await user.type(field(hypothesis, 'statement'), 'The N-terminal signal peptide is cleaved.');
    await user.type(field(form('hypothesis'), 'conditions'), 'Secretory pathway');
    await user.type(field(form('hypothesis'), 'discriminator'), 'Mass of the mature protein');
    await user.click(document.querySelector('[data-research-lifecycle-submit="hypothesis"]') as HTMLButtonElement);
    await waitFor(() => expect(publishRecord).toHaveBeenCalled());
    const [record, options] = publishRecord.mock.calls[0] as unknown as [Record<string, any>, Record<string, unknown>];
    expect(options).toEqual({ roomId: 'unit-room' });
    expect(record.kind).toBe('research_hypothesis');
    expect(record.questionHash).toBe(question.recordHash);
    expect(record.hypothesis.statement).toBe('The N-terminal signal peptide is cleaved.');
    await waitFor(() => expect(document.querySelector('[data-pool-research-sync]')!.textContent).toBe('Lifecycle evidence saved locally; coordinator sync pending'));
    expect((field(form('hypothesis'), 'statement') as unknown as HTMLTextAreaElement).value).toBe('');
  });

  it('signs a review decision on the addressed evidence and states where it was saved', async () => {
    const user = userEvent.setup();
    const question = await seedQuestion();
    const { publishRecord, services, retainTarget } = mount({ href: `https://reploid.invalid/room-1?room=unit-room&panel=review&target=${encodeURIComponent('sha256:' + 'f'.repeat(64))}` });
    const review = document.querySelector('[data-research-review-form]') as HTMLElement;
    // An address naming a record the room does not hold selects the first target instead.
    expect((within(field(review, 'targetHash')).getAllByRole('radio')[0] as HTMLInputElement).checked).toBe(true);
    expect(review.querySelector('[data-research-review-context]')!.textContent).toContain('Similarity and retrieval ranking do not establish agreement.');
    await user.click(within(review).getByRole('button', { name: 'Accept evidence' }));
    await waitFor(() => expect(review.querySelector('[data-research-review-status]')!.textContent).toBe('Explain the decision, the correction, or what an independent replication should check.'));
    act(() => services.setReview('target', question.recordHash));
    expect(retainTarget).toHaveBeenCalledWith(question.recordHash);
    await user.type(field(document.querySelector('[data-research-review-form]')!, 'text'), 'The question is bounded and public.');
    await user.click(within(document.querySelector('[data-research-review-form]') as HTMLElement).getByRole('button', { name: 'Accept evidence' }));
    await waitFor(() => expect(publishRecord).toHaveBeenCalled());
    const [record] = publishRecord.mock.calls[0] as unknown as [Record<string, any>];
    expect(record.kind).toBe('human_claim');
    expect(record.targetHash).toBe(question.recordHash);
    expect(record.claim).toMatchObject({ kind: 'review_decision', decision: 'accepted', text: 'The question is bounded and public.' });
    await waitFor(() => expect(document.querySelector('[data-research-review-status]')!.textContent).toBe('Signed review record saved locally; coordinator sync is pending.'));
  });

  it('shows the replay checkpoint, criteria, proof, campaign and prior-room sections for a question', async () => {
    await seedQuestion();
    mount();
    const contract = document.querySelector('[data-pool-room-contract]')!;
    expect(contract.textContent).toContain('Checkpoint missing');
    expect((within(contract as HTMLElement).getByRole('button', { name: 'Sign first checkpoint' }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector('[data-pool-room-resolution]')!.textContent).toContain('Criteria missing');
    expect(document.querySelector('[data-pool-room-adjudication-proof]')!.textContent).toContain('Reploid has not demonstrated its first product win.');
    expect(document.querySelector('[data-pool-protein-campaign]')!.textContent).toContain('does not rank biological importance, truth, or execution priority');
    expect(document.querySelector('[data-pool-room-prior-evidence]')!.textContent).toContain('Prior-room evidence has not been loaded for this sequence.');
    expect(document.querySelector('[data-pool-room-adjudication-canvas]')!.textContent).toContain('Disputed Evidence & Memory State');
  });
});
