import type { ComputerChoice, ModelSheetState } from '../domain/chat';
import type { AnswerDecisions, ContributorBlock, SheetSide } from '../domain/decisions';
import type { HostChatState, HostModel } from '../domain/session';

/** What the person has staged in the sheet; it applies only when committed. */
export type SheetSelection = {
  readonly side: SheetSide;
  readonly model: HostModel | null;
  /** True while the staged model came from a computer tap, so it may follow that computer. */
  readonly implied: boolean;
};

export type SheetLabels = {
  readonly thisDevice: string;
  readonly contributors: string;
};

export const modelKey = (model: HostModel | null | undefined) => model?.selectionId || model?.id || null;

/** The computer rows' status, as the vanilla sheet words it. */
function computerStatus(choice: ComputerChoice, state: HostChatState, selected: HostModel | null, block: ContributorBlock, decisions: AnswerDecisions): string {
  if (choice === 'local') {
    if (decisions.executionState(selected, 'local').usable) return 'Ready';
    return selected && decisions.canDownloadHere(selected, state) ? 'Download needed' : 'Runs stored models';
  }
  if (block === 'own-devices') return 'Off · Only your devices';
  if (decisions.executionState(selected, 'network').usable) return 'Ready';
  if ((state.models ?? []).some((model) => decisions.executionState(model, 'network').usable)) return 'Not serving this model';
  return state.discoveryPhase === 'searching' ? 'Finding computers…' : 'None available';
}

function modelStatus(model: HostModel, side: SheetSide): string {
  if (side === 'local') return model.localReady ? 'Loaded on this device' : model.localCached ? 'On this device' : 'Not on this device';
  const availability = model.networkAvailability ?? model.availability;
  if (availability === 'ready') return 'Ready';
  if (availability === 'busy') return 'Busy';
  if (availability === 'loading' || availability === 'preparing') return 'Preparing';
  return 'No computer serves it now';
}

function disclosure(side: SheetSide, block: ContributorBlock, model: HostModel | null): string {
  if (side === 'local') return 'Nothing leaves this device.';
  if (block) return 'Nothing leaves this device unless you choose Use contributors.';
  if (model?.partition) return 'Computers on this route can read the input for their own stages.';
  if (model?.fleet) return 'The answering computer in your private pool can read your prompt.';
  return 'The answering computer can read your prompt.';
}

/** The "Answer on" sheet for the staged selection, judged by the host's decisions. */
export function projectModelSheet(
  state: HostChatState,
  selection: SheetSelection,
  { decisions, block, sending, labels }: { readonly decisions: AnswerDecisions; readonly block: ContributorBlock; readonly sending: boolean; readonly labels: SheetLabels },
): ModelSheetState {
  const selected = (state.models ?? []).find((model) => modelKey(model) === modelKey(selection.model)) ?? selection.model;
  const outcome = decisions.describeAnswerChoice(selected, selection.side, {
    state,
    block,
    canDownload: decisions.canDownload,
    choice: null,
    locked: null,
    sending,
    implied: selection.implied,
  });
  // One row per selectable model; variants that share a selection key keep the first.
  const rows = new Map<string, HostModel>();
  for (const model of state.models ?? []) {
    const id = modelKey(model) ?? model.id;
    if (!rows.has(id)) rows.set(id, model);
  }
  return {
    computers: [
      { id: 'local', title: labels.thisDevice, status: computerStatus('local', state, selected, block, decisions) },
      { id: 'network', title: labels.contributors, status: computerStatus('network', state, selected, block, decisions) },
    ],
    computer: selection.side,
    models: [...rows].map(([id, model]) => ({ id, name: decisions.modelLabel(model), status: modelStatus(model, selection.side) })),
    model: modelKey(selected),
    disclosure: disclosure(selection.side, block, selected),
    facts: '',
    outcome,
    searching: state.discoveryPhase === 'searching',
  };
}

/** The computer a model tap implies: where that model runs, unless the preset forbids it. */
export const sideForModel = (decisions: AnswerDecisions, model: HostModel | null, side: SheetSide, block: ContributorBlock): SheetSide =>
  decisions.locationForModel(model, side, { block, choice: null });
