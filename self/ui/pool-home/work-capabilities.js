/** Views of host-owned helpers, peer participation and protected tool experiments. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]);
export const renderToolExperiments = () => '<section class="pool-work-experiments" data-work-experiments hidden aria-label="Tool improvements">'
  + '<h2 class="type-h2">Tool improvements</h2><p class="pool-control-help">Compare tested versions, choose what to use, and keep a way back. These tests cover the named tool, not general intelligence.</p>'
  + '<div data-work-candidates></div><p role="status" data-experiment-status></p></section>';
export const renderTextSwarm = () => '<section class="pool-control-panel" aria-label="Agent network">'
  + '<h2 class="type-h2">Let agents help each other</h2>'
  + '<p>Another device can run a whole inference request. Each device runs its own model.</p>'
  + '<div class="pool-control-actions"><button class="btn btn-ghost" data-swarm-connect>Find helper devices</button>'
  + '<button class="btn btn-ghost" data-swarm-invite>Create invitation</button></div>'
  + '<p role="status" aria-live="polite" data-swarm-status>Not connected to the text swarm.</p>'
  + '<div data-swarm-peers></div><p data-swarm-invitation hidden></p>'
  + '<details class="pool-work-settings"><summary>Offer this device’s model</summary>'
  + '<div class="pool-work-drawer-body"><p>Run public prompts for other agents using Qwen 3.5 2B on this device. The model may download on first use.</p>'
  + '<label class="pool-consent-row"><input type="checkbox" data-swarm-consent><span>Allow this device to process other agents’ public prompts.</span></label>'
  + '<button class="btn btn-primary" data-swarm-share>Start sharing</button>'
  + '<p class="pool-control-help">Text sharing uses the compatibility swarm protocol. It does not claim signed Pack qualification or independent verification of answers.</p></div></details></section>';

export function bindWorkCapabilities(root, application, { evolution, swarm } = {}) {
  const controller = new AbortController();
  let revision = 0, swarmError = '';
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
        view.hidden = !candidates.length;
        list.innerHTML = [...candidates].reverse().map(item => {
          const evaluation = item.evaluation;
          const busy = state.busy ? ' disabled' : '';
          return '<article class="pool-work-candidate"><h3>' + escape(item.targetId) + ' <span class="type-caption">' + escape(item.status) + '</span></h3>'
            + '<p>' + escape(item.reason) + '</p>'
            + (evaluation ? '<p>Current: ' + evaluation.baselinePassed + '/' + evaluation.total + ' checks. Candidate: '
              + evaluation.candidatePassed + '/' + evaluation.total + ' checks.</p>' : '')
            + (item.error ? '<p class="pool-work-error">' + escape(item.error) + '</p>' : '')
            + '<details><summary>Inspect proposed code</summary><pre>' + escape(item.code) + '</pre></details>'
            + '<button class="btn btn-ghost" data-candidate-export="' + escape(item.id) + '">Download evaluation</button>'
            + (item.status === 'awaiting-approval' ? '<div class="pool-work-actions"><button class="btn btn-primary" data-candidate-adopt="' + escape(item.id) + '"' + busy + '>Use this version</button>'
              + '<button class="btn btn-ghost" data-candidate-reject="' + escape(item.id) + '"' + busy + '>Keep current version</button></div>' : '')
            + (item.status === 'adopted' && active.some(version => version.episodeId === item.id) ? '<button class="btn btn-ghost" data-candidate-rollback="' + escape(item.id) + '"' + busy + '>Restore previous version</button>' : '') + '</article>';
        }).join('');
      } catch (error) { if (!controller.signal.aborted) { view.hidden = false; status(error.message); } }
    }
    refreshSwarm();
  };
  const refreshSwarm = () => {
    if (!swarm || controller.signal.aborted) return;
    const state = swarm.getState(), node = root.querySelector('[data-swarm-status]');
    const snapshot = state.consumer || state.supplier;
    const helperCount = root.querySelector('[data-work-helper-count]');
    if (helperCount) {
      const count = snapshot?.providerCount || 0;
      helperCount.hidden = count === 0;
      helperCount.textContent = count + ' text helper' + (count === 1 ? '' : 's') + ' · ';
      helperCount.title = 'Available text models in the helper network';
    }
    if (!node) return;
    node.textContent = swarmError || state.error || (state.stopping ? 'Stopping sharing; waiting for owned model work to finish...' : state.connecting ? 'Looking for helper devices...' : snapshot
      ? (snapshot.transport === 'webrtc' ? 'WebRTC' : 'Same-browser connection') + ' · ' + snapshot.providerCount + ' helper device(s) available'
        + (state.sharing ? ' · Sharing this device’s model' : '') : 'Not connected to the text swarm.');
    const peers = root.querySelector('[data-swarm-peers]');
    peers.replaceChildren();
    for (const peer of snapshot?.peers || []) {
      const p = document.createElement('p'); p.className = 'type-caption';
      p.textContent = (peer.model || 'Agent without a local model') + ' · ' + peer.peerId.slice(0, 16); peers.append(p);
    }
    const share = root.querySelector('[data-swarm-share]');
    if (share) { share.textContent = state.sharing ? 'Stop sharing' : 'Start sharing'; share.disabled = state.stopping; }
    const consent = root.querySelector('[data-swarm-consent]');
    if (consent) consent.disabled = state.sharing || state.stopping;
    const connect = root.querySelector('[data-swarm-connect]');
    if (connect) { connect.textContent = state.consumer ? 'Leave helper network' : 'Find helper devices'; connect.disabled = state.connecting; }
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
      else if (button.hasAttribute('data-swarm-share')) {
        if (swarm.getState().sharing) await swarm.stop();
        else await swarm.share(swarm.getState().models[0].id, root.querySelector('[data-swarm-consent]').checked);
      } else if (button.hasAttribute('data-swarm-invite')) {
        const url = new URL(location.href); url.pathname = '/network';
        if (!url.searchParams.get('swarm')) url.searchParams.set('swarm', crypto.randomUUID());
        if (!url.searchParams.get('swarmToken')) url.searchParams.set('swarmToken', crypto.randomUUID() + crypto.randomUUID());
        const node = root.querySelector('[data-swarm-invitation]'); node.hidden = false; node.replaceChildren();
        const link = document.createElement('a'); link.href = url.href; link.textContent = 'Open this room, then share its address with your other device.';
        node.append(link);
      }
      await refresh();
    } catch (error) {
      const node = root.querySelector('[data-swarm-status]');
      if (button.hasAttribute('data-swarm-connect') || button.hasAttribute('data-swarm-share')) { swarmError = error.message; if (node) node.textContent = error.message; }
      else status(error.message);
    } finally { if (!controller.signal.aborted) button.disabled = false; }
  }, { signal: controller.signal });
  const unsubscribe = application.subscribe(() => { void refresh(); });
  const timer = setInterval(refreshSwarm, 1000);
  return () => { revision++; controller.abort(); unsubscribe(); clearInterval(timer); };
}
