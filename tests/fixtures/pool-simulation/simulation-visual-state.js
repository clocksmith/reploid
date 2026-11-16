/**
 * @fileoverview The simulation's copy of the observed network and run visual state. Decoration
 * follows this recorded state; it never signals execution by itself.
 */
import { POOLDAY_PARTICIPANT_NODE_IDS } from './constants.js';

export const createPoolNetworkVisualState = () => ({
  mode: 'simulation',
  peerCount: 0,
  providerCount: 0,
  messageCount: 0,
  liveParticipantCount: 0,
  simulationMix: 1,
  liveMix: 0,
  slots: POOLDAY_PARTICIPANT_NODE_IDS.map(() => ({
    id: null,
    provider: false,
    mix: 0
  })),
  recent: []
});

export const createPoolRunVisualState = () => ({
  state: 'idle',
  phase: '',
  message: '',
  energy: 0.22
});

export const setPoolSimulationNetworkVisualState = (state, visual = {}) => {
  const network = state?.networkVisual;
  if (!network) return null;
  network.mode = ['simulation', 'hybrid', 'live'].includes(visual.mode)
    ? visual.mode
    : 'simulation';
  network.peerCount = Math.max(0, Number(visual.peerCount) || 0);
  network.providerCount = Math.max(0, Number(visual.providerCount) || 0);
  network.messageCount = Math.max(0, Number(visual.messageCount) || 0);
  network.liveParticipantCount = Math.min(
    network.slots.length,
    Math.max(0, Number(visual.liveParticipantCount) || 0)
  );
  const participants = Array.isArray(visual.participants) ? visual.participants : [];
  for (let index = 0; index < network.slots.length; index += 1) {
    const participant = participants[index] || null;
    network.slots[index].id = participant?.id ? String(participant.id) : null;
    network.slots[index].provider = participant?.provider === true;
  }
  network.recent = Array.isArray(visual.recent) ? visual.recent.slice(0, 10) : [];
  return network;
};

export const setPoolSimulationRunVisualState = (state, visual = {}) => {
  const run = state?.runVisual;
  if (!run) return null;
  run.state = ['idle', 'submitting', 'running', 'complete', 'error', 'inspecting'].includes(visual.state)
    ? visual.state
    : 'idle';
  run.phase = String(visual.phase || '');
  run.message = String(visual.message || '');
  return run;
};
