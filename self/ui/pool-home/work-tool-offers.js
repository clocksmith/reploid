/** Explicit file handoff. Only the host evaluates and activates imported code. */
export const renderToolOfferImport = () => `
  <details class="pool-work-settings" data-tool-offer-panel hidden>
    <summary>Import a tool</summary>
    <div class="pool-work-drawer-body">
      <label class="pool-consent-row"><input type="checkbox" data-tool-offer-receive disabled> Receive tool offers from connected peers</label>
      <label>Candidate file <input type="file" accept=".json,application/json" data-tool-offer-file></label>
      <div data-tool-offer-preview hidden>
        <strong data-tool-offer-target></strong><p data-tool-offer-reason></p>
        <p class="pool-control-help" data-tool-offer-source></p>
        <details><summary>Inspect code</summary><pre data-tool-offer-code></pre></details>
        <p class="pool-control-help">Test against this device’s current tool. Adoption requires your separate approval.</p>
        <button type="button" class="btn btn-primary" data-tool-offer-evaluate disabled>Evaluate on this device</button>
      </div>
    </div>
  </details><div data-tool-peer-inbox></div>`;

export function bindToolOffers(root, application, evolution, onUpdated, swarm) {
  const panel = root.querySelector('[data-tool-offer-panel]');
  if (!panel || !evolution?.offerLimits) return () => {};
  panel.hidden = false;
  const controller = new AbortController(), fileInput = panel.querySelector('[data-tool-offer-file]');
  const preview = panel.querySelector('[data-tool-offer-preview]'), evaluate = panel.querySelector('[data-tool-offer-evaluate]');
  const status = value => { if (!controller.signal.aborted) root.querySelector('[data-experiment-status]').textContent = value; };
  let selection = 0, pending = null, evaluating = false, peerIdentity = '';
  const receive = panel.querySelector('[data-tool-offer-receive]');
  const inbox = root.querySelector('[data-tool-peer-inbox]');
  const refresh = () => {
    const busy = application.getState().busy;
    fileInput.disabled = evaluating || busy;
    evaluate.disabled = !pending || evaluating || busy;
    for (const button of root.querySelectorAll('[data-tool-offer-export]')) button.disabled = evaluating || busy;
    const state = swarm?.getState?.(), offers = state?.offers;
    receive.disabled = !state?.consumer || !offers;
    receive.checked = offers?.accepting === true;
    const peers = offers?.peers || [];
    for (const select of root.querySelectorAll('[data-tool-peer]')) {
      const identity = JSON.stringify(peers.map(peer => peer.id));
      if (select.dataset.peers !== identity) {
        const previous = select.value; select.dataset.peers = identity;
        select.replaceChildren(...[{ id: '', label: peers.length ? 'Choose a peer' : 'Connect a peer' }, ...peers].map(peer => {
          const option = document.createElement('option'); option.value = peer.id;
          option.textContent = peer.label || 'Peer ' + peer.id.slice(0, 8); return option;
        }));
        if (peers.some(peer => peer.id === previous)) select.value = previous;
      }
      select.disabled = evaluating || busy;
      const button = [...root.querySelectorAll('[data-tool-offer-send]')].find(item => item.dataset.toolOfferSend === select.dataset.toolPeer);
      if (button) button.disabled = evaluating || busy || !select.value;
    }
    const identity = JSON.stringify([offers?.inbox, offers?.outbox, (offers?.outbox || []).map(row => row.envelope.expiresAt <= Date.now())]);
    if (peerIdentity !== identity) {
      peerIdentity = identity; inbox.replaceChildren();
      const action = (label, key, id) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-ghost'; button.textContent = label; button.setAttribute(key, id); return button; };
      for (const record of offers?.inbox || []) {
        if (record.status !== 'received' || record.dismissed) continue;
        const row = document.createElement('div'), text = document.createElement('p');
        text.className = 'pool-control-help'; text.textContent = record.envelope.targetId + ' offered by Peer ' + record.sender.slice(0, 8);
        row.append(text, action('Preview candidate', 'data-tool-offer-preview-peer', record.transferId), action('Dismiss', 'data-tool-offer-dismiss', record.transferId));
        inbox.append(row);
      }
      for (const record of offers?.outbox || []) {
        const expired = record.envelope.expiresAt <= Date.now();
        const row = document.createElement('div'), text = document.createElement('p'); text.className = 'pool-control-help';
        text.textContent = record.envelope.targetId + ' to Peer ' + record.envelope.recipient.slice(0, 8) + ' · '
          + (record.status === 'received' ? 'Received for preview' : record.status === 'refused' ? 'Refused: ' + record.reason : expired ? 'Delivery expired' : 'Delivery not confirmed');
        row.append(text);
        if (!expired && ['sending', 'interrupted'].includes(record.status) && record.attempts < offers.maxAttempts) row.append(action('Retry delivery', 'data-tool-offer-retry', record.envelope.transferId));
        inbox.append(row);
      }
    }
  };
  const showPreview = (text, offer, provenance) => {
    pending = { text, baselineGeneration: offer.baselineGeneration, provenance };
    panel.querySelector('[data-tool-offer-target]').textContent = offer.targetId;
    panel.querySelector('[data-tool-offer-reason]').textContent = offer.reason;
    panel.querySelector('[data-tool-offer-code]').textContent = offer.code;
    panel.querySelector('[data-tool-offer-source]').textContent = provenance ? 'From Peer ' + provenance.sender.slice(0, 8) + ' · not evaluated on this device' : 'Imported file · not evaluated on this device';
    panel.open = true; preview.hidden = false;
    status('Candidate loaded. Review its code before evaluating.'); refresh();
  };
  fileInput.addEventListener('change', async () => {
    const selected = ++selection;
    pending = null; preview.hidden = true; refresh();
    const file = fileInput.files[0];
    if (!file) return;
    try {
      if (file.size > evolution.offerLimits.maxBytes) throw new Error('Candidate file exceeds its allowance');
      const text = await file.text(), offer = await evolution.inspectOffer(text);
      if (controller.signal.aborted || selected !== selection) return;
      showPreview(text, offer);
    } catch (error) { if (selected === selection) status(error.message); }
    finally { if (!controller.signal.aborted && selected === selection) refresh(); }
  }, { signal: controller.signal });
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-tool-offer-evaluate], [data-tool-offer-export], [data-tool-offer-send], [data-tool-offer-preview-peer], [data-tool-offer-dismiss], [data-tool-offer-retry]');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      if (application.getState().busy) throw new Error('Wait for the task to finish before exchanging tools');
      if (button.hasAttribute('data-tool-offer-preview-peer')) {
        const current = ++selection;
        const received = await swarm.previewCandidate(button.dataset.toolOfferPreviewPeer);
        if (!controller.signal.aborted && current === selection) showPreview(received.text, received.offer, received.provenance);
      } else if (button.hasAttribute('data-tool-offer-dismiss')) {
        await swarm.dismissCandidate(button.dataset.toolOfferDismiss); status('Candidate dismissed. Active tools are unchanged.');
      } else if (button.hasAttribute('data-tool-offer-send')) {
        const select = [...root.querySelectorAll('[data-tool-peer]')].find(item => item.dataset.toolPeer === button.dataset.toolOfferSend);
        await swarm.sendCandidate(button.dataset.toolOfferSend, select.value);
        status('Delivery requested. Receipt is not evaluation or adoption.');
      } else if (button.hasAttribute('data-tool-offer-retry')) {
        await swarm.retryCandidate(button.dataset.toolOfferRetry);
      } else if (button.hasAttribute('data-tool-offer-export')) {
        const offer = await evolution.exportOffer(button.dataset.toolOfferExport);
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(offer, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'reploid-tool-candidate.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        status('Candidate downloaded: code and description only. Import the file on another device to test it there.');
      } else {
        if (!pending || evaluating) return;
        evaluating = true; refresh(); status('Testing the imported candidate on this device...');
        const candidate = await evolution.importOffer(pending.text, { baselineGeneration: pending.baselineGeneration, provenance: pending.provenance, signal: controller.signal });
        pending = null; preview.hidden = true; fileInput.value = '';
        status(candidate.status === 'awaiting-approval' ? 'Local tests passed. Review the candidate before choosing Use this version.'
          : 'Candidate not ready for adoption. Its local test result is retained below.');
      }
      if (!controller.signal.aborted) await onUpdated();
    } catch (error) { status(error.message); }
    finally { evaluating = false; if (!controller.signal.aborted) { button.disabled = false; refresh(); } }
  }, { signal: controller.signal });
  root.addEventListener('change', event => {
    if (event.target === receive) {
      try { swarm.allowCandidateOffers(receive.checked); }
      catch (error) { status(error.message); }
    }
    refresh();
  }, { signal: controller.signal });
  const unsubscribe = application.subscribe(refresh);
  const timer = setInterval(refresh, 1000);
  refresh();
  return () => { selection++; controller.abort(); unsubscribe(); clearInterval(timer); };
}
