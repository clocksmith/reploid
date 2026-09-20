/** Views of host-owned helpers, peer participation and protected tool experiments. */
import { renderAgentNetwork, refreshAgentNetwork } from './agent-network.js';
import { renderToolOfferImport, bindToolOffers } from './work-tool-offers.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]);
export const renderToolExperiments = () => '<section class="pool-work-experiments" id="reploid-improvements" data-work-experiments aria-label="Tool improvements">'
  + '<h2 class="type-h2">Changes</h2><p class="pool-control-help" data-improvement-empty>No tool changes yet.</p>'
  + renderToolOfferImport() + '<div data-work-candidates></div><p role="status" data-experiment-status></p></section>';
export const renderTextSwarm = renderAgentNetwork;
const candidateState = item => ({ evaluating: 'Testing', 'awaiting-approval': 'Tested · approval needed',
  adopted: 'Adopted on this device', rejected: 'Not adopted', 'rolled-back': 'Reverted', failed: 'Test failed', cancelled: 'Testing stopped' })[item.status] || item.status;

export function bindWorkCapabilities(root, application, { evolution, swarm } = {}) {
  const controller = new AbortController();
  const contributionPanel = root.querySelector('[data-contribution-panel]');
  contributionPanel?.addEventListener('toggle', () => {
    if (contributionPanel.dataset.active === 'true') contributionPanel.open = true;
  }, { signal: controller.signal });
  let revision = 0, swarmError = '', candidateIdentity = '';
  const status = message => { const node = root.querySelector('[data-experiment-status]'); if (node) node.textContent = message; };
  const refresh = async () => {
    const current = ++revision;
    const view = root.querySelector('[data-work-experiments]');
    if (view && evolution) {
      try {
        const candidates = await evolution.list();
        const active = await evolution.describe();
        if (controller.signal.aborted || current !== revision) return;
        const state = application.getState();
        const list = root.querySelector('[data-work-candidates]');
        view.hidden = false;
        root.querySelector('[data-improvement-empty]').hidden = candidates.length > 0;
        const identity = JSON.stringify([candidates, active, state.busy, state.records.map(row => [row.id, row.goal, row.improvements])]);
        if (candidateIdentity !== identity) { candidateIdentity = identity;
        const disclosure = view.closest('.pool-work-secondary');
        if (disclosure && candidates.some(item => ['awaiting-approval', 'failed'].includes(item.status))) disclosure.open = true;
        list.innerHTML = [...candidates].reverse().map(item => {
          const evaluation = item.evaluation;
          const busy = state.busy ? ' disabled' : '';
          const origin = state.records.find(row => row.improvements?.some(change => change.id === item.id));
          return '<article class="pool-work-candidate"><h3>' + escape(item.targetId) + ' <span class="type-caption">' + escape(candidateState(item)) + '</span></h3>'
            + (origin ? '<button class="pool-candidate-origin" data-work-select="' + escape(origin.id) + '">From task: ' + escape(origin.goal) + '</button>' : '')
            + (item.origin ? '<p class="type-caption">Imported candidate · local evaluation</p>' : '')
            + '<p>' + escape(item.reason) + '</p>'
            + (evaluation ? '<p>Current: ' + evaluation.baselinePassed + '/' + evaluation.total + ' checks. Candidate: '
              + evaluation.candidatePassed + '/' + evaluation.total + ' checks.</p>' : '')
            + (evaluation?.latency ? '<details><summary>Measured execution</summary><p>Current: '
              + evaluation.latency.baselineMedianMs.toFixed(1) + ' ms. Candidate: ' + evaluation.latency.candidateMedianMs.toFixed(1)
              + ' ms. ' + (evaluation.improvementKind === 'latency' ? 'Qualifying latency improvement.' : evaluation.improvementKind === 'correctness' ? 'Qualified by correctness repair.' : 'No qualifying improvement.')
              + '</p><p class="pool-control-help">Objective ' + escape(evaluation.latency.objectiveId) + ' v'
              + evaluation.latency.objectiveVersion + '. Host measurements include sandbox startup. '
              + evaluation.latency.fasterPairs + '/' + evaluation.latency.observations.length + ' pairs were faster.</p></details>' : '')
            + (item.error ? '<p class="pool-work-error">' + escape(item.error) + '</p>' : '')
            + '<details><summary>Code &amp; sharing</summary><pre>' + escape(item.code) + '</pre>'
            + (evolution.offerLimits ? '<p class="pool-control-help">The candidate file includes this code and description. Check both before sharing.</p>'
              + '<button class="btn btn-ghost" data-tool-offer-export="' + escape(item.id) + '"' + busy + '>Download candidate</button>' : '')
            + (swarm && evolution.offerLimits ? '<div class="pool-work-actions"><label>Recipient <select data-tool-peer="' + escape(item.id) + '"><option value="">Connect a peer</option></select></label>'
              + '<button class="btn btn-ghost" data-tool-offer-send="' + escape(item.id) + '" disabled>Send candidate</button></div>' : '')
            + '<button class="btn btn-ghost" data-candidate-export="' + escape(item.id) + '">Download evaluation</button></details>'
            + (item.status === 'awaiting-approval' ? '<div class="pool-work-actions"><button class="btn btn-primary" data-candidate-adopt="' + escape(item.id) + '"' + busy + '>Use this version</button>'
              + '<button class="btn btn-ghost" data-candidate-reject="' + escape(item.id) + '"' + busy + '>Keep current version</button></div>' : '')
            + (item.status === 'adopted' && active.some(version => version.episodeId === item.id) ? '<button class="btn btn-ghost" data-candidate-rollback="' + escape(item.id) + '"' + busy + '>Restore previous version</button>' : '') + '</article>';
        }).join('');
        }
      } catch (error) { if (!controller.signal.aborted) {
        view.hidden = false;
        const disclosure = view.closest('.pool-work-secondary');
        if (disclosure) disclosure.open = true;
        status(error.message);
      } }
    }
    refreshSwarm();
  };
  const refreshSwarm = () => {
    if (controller.signal.aborted) return;
    const state = swarm?.getState?.() || {}, node = root.querySelector('[data-swarm-status]');
    refreshAgentNetwork(root, application.getState(), state);
    const snapshot = state.consumer || state.supplier;
    const helperCount = root.querySelector('[data-work-helper-count]');
    if (helperCount) {
      const count = snapshot?.providerCount || 0;
      helperCount.hidden = count === 0;
      helperCount.textContent = count + ' text helper' + (count === 1 ? '' : 's') + ' · ';
      helperCount.title = 'Available text models in the helper network';
    }
    if (!node) return;
    node.textContent = swarmError || state.error || (state.connecting ? 'Connecting peers...' : snapshot
      ? (snapshot.transport === 'webrtc' ? 'WebRTC connected' : 'Same-browser connection') : 'No peers connected.');
    const text = (selector, value) => { const node = root.querySelector(selector); if (node) node.textContent = value; };
    text('[data-contribution-model]', (state.models?.[0]?.name || 'Local model') + ' · this device');
    text('[data-contribution-status]', state.stopping ? 'Stopping · waiting for model work to settle'
      : state.contribution?.phase === 'loading' ? 'Preparing model for a peer'
      : state.contribution?.phase === 'executing' ? 'Running a peer request'
      : state.sharing ? 'Offering compute · ' + (state.contribution?.completed || 0) + ' completed' : 'Not sharing');
    text('[data-contribution-limits]', state.limits ? state.limits.maxInboundJobs + ' request at a time · up to ' + state.limits.maxOutputTokens + ' output tokens per request' : 'Sharing limits are unavailable.');
    const stop = root.querySelector('[data-swarm-stop]');
    if (stop) { stop.hidden = !state.sharing && !state.stopping; stop.disabled = state.stopping; }
    const settings = root.querySelector('[data-contribution-settings]');
    if (settings) settings.hidden = !!state.sharing || !!state.stopping;
    const contribution = root.querySelector('[data-contribution-panel]');
    if (contribution) {
      const active = !!state.sharing || !!state.stopping;
      if (active || (contribution.dataset.active === 'true' && !active)) contribution.open = active;
      contribution.dataset.active = String(active);
    }

    const share = root.querySelector('[data-swarm-share]');
    if (share) { share.textContent = state.sharing ? 'Stop sharing' : 'Start sharing'; share.disabled = !!state.stopping || !swarm; }
    const consent = root.querySelector('[data-swarm-consent]');
    if (consent) consent.disabled = state.sharing || state.stopping;
    const connect = root.querySelector('[data-swarm-connect]');
    if (connect) { connect.textContent = state.consumer ? 'Disconnect peers' : 'Connect peers'; connect.disabled = state.connecting || !swarm; }
  };
  root.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    const relevant = [...button.attributes].some(attr => attr.name.startsWith('data-candidate-') || attr.name.startsWith('data-swarm-'));
    if (!relevant) return;
    swarmError = '';
    button.disabled = true;
    try {
      if (button.dataset.candidateAdopt || button.dataset.candidateReject) {
        if (application.getState().busy) throw new Error('Wait for the task to finish before changing its tools');
        await evolution.decide(button.dataset.candidateAdopt || button.dataset.candidateReject, !!button.dataset.candidateAdopt);
        status(button.dataset.candidateAdopt ? 'New tasks will use this version. The previous version is retained.' : 'Current version kept.');
      } else if (button.dataset.candidateRollback) {
        if (application.getState().busy) throw new Error('Wait for the task to finish before changing its tools');
        await evolution.rollback(button.dataset.candidateRollback); status('Previous version restored for new tasks.');
      } else if (button.dataset.candidateExport) {
        const evidence = await evolution.export(button.dataset.candidateExport);
        const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'reploid-tool-evaluation.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } else if (button.hasAttribute('data-swarm-connect')) {
        if (swarm.getState().consumer) await swarm.disconnect(); else await swarm.connect();
      }
      else if (button.hasAttribute('data-swarm-share') || button.hasAttribute('data-swarm-stop')) {
        if (swarm.getState().sharing) await swarm.stop();
        else await swarm.share(swarm.getState().models[0].id, root.querySelector('[data-swarm-consent]').checked);
      } else if (button.hasAttribute('data-swarm-invite')) {
        const url = new URL(location.href); url.pathname = '/';
        if (!url.searchParams.get('swarm')) url.searchParams.set('swarm', crypto.randomUUID());
        if (!url.searchParams.get('swarmToken')) url.searchParams.set('swarmToken', crypto.randomUUID() + crypto.randomUUID());
        const node = root.querySelector('[data-swarm-invitation]'); node.hidden = false; node.replaceChildren();
        const link = document.createElement('a'); link.href = url.href; link.textContent = 'Join this room, then share its link';
        node.append(link);
      }
      await refresh();
    } catch (error) {
      const node = root.querySelector('[data-swarm-status]');
      if (button.hasAttribute('data-swarm-connect') || button.hasAttribute('data-swarm-share') || button.hasAttribute('data-swarm-stop')) { swarmError = error.message; if (node) node.textContent = error.message; }
      else status(error.message);
    } finally { if (!controller.signal.aborted) { button.disabled = false; refreshSwarm(); } }
  }, { signal: controller.signal });
  root.addEventListener('change', refreshSwarm, { signal: controller.signal });
  const unsubscribe = application.subscribe(() => { void refresh(); });
  const timer = setInterval(refreshSwarm, 1000);
  const unbindOffers = bindToolOffers(root, application, evolution, refresh, swarm);
  return () => { revision++; controller.abort(); unsubscribe(); unbindOffers(); clearInterval(timer); };
}
