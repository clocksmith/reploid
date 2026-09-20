/** Explicit file handoff. Only the host evaluates and activates imported code. */
export const renderToolOfferImport = () => `
  <details class="pool-work-settings" data-tool-offer-panel hidden>
    <summary>Import a tool</summary>
    <div class="pool-work-drawer-body">
      <label>Candidate file <input type="file" accept=".json,application/json" data-tool-offer-file></label>
      <div data-tool-offer-preview hidden>
        <strong data-tool-offer-target></strong><p data-tool-offer-reason></p>
        <details><summary>Inspect code</summary><pre data-tool-offer-code></pre></details>
        <p class="pool-control-help">Test against this device’s current tool. Adoption requires your separate approval.</p>
        <button type="button" class="btn btn-primary" data-tool-offer-evaluate disabled>Evaluate on this device</button>
      </div>
    </div>
  </details>`;

export function bindToolOffers(root, application, evolution, onUpdated) {
  const panel = root.querySelector('[data-tool-offer-panel]');
  if (!panel || !evolution?.offerLimits) return () => {};
  panel.hidden = false;
  const controller = new AbortController(), fileInput = panel.querySelector('[data-tool-offer-file]');
  const preview = panel.querySelector('[data-tool-offer-preview]'), evaluate = panel.querySelector('[data-tool-offer-evaluate]');
  const status = value => { if (!controller.signal.aborted) root.querySelector('[data-experiment-status]').textContent = value; };
  let selection = 0, pending = null, evaluating = false;
  const refresh = () => {
    const busy = application.getState().busy;
    fileInput.disabled = evaluating || busy;
    evaluate.disabled = !pending || evaluating || busy;
    for (const button of root.querySelectorAll('[data-tool-offer-export]')) button.disabled = evaluating || busy;
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
      pending = { text, baselineGeneration: offer.baselineGeneration };
      panel.querySelector('[data-tool-offer-target]').textContent = offer.targetId;
      panel.querySelector('[data-tool-offer-reason]').textContent = offer.reason;
      panel.querySelector('[data-tool-offer-code]').textContent = offer.code;
      preview.hidden = false;
      status('Candidate loaded. Review its code before evaluating.');
    } catch (error) { if (selected === selection) status(error.message); }
    finally { if (!controller.signal.aborted && selected === selection) refresh(); }
  }, { signal: controller.signal });
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-tool-offer-evaluate], [data-tool-offer-export]');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      if (application.getState().busy) throw new Error('Wait for the task to finish before exchanging tools');
      if (button.hasAttribute('data-tool-offer-export')) {
        const offer = await evolution.exportOffer(button.dataset.toolOfferExport);
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(offer, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'reploid-tool-candidate.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        status('Candidate downloaded: code and description only. Import the file on another device to test it there.');
      } else {
        if (!pending || evaluating) return;
        evaluating = true; refresh(); status('Testing the imported candidate on this device...');
        const candidate = await evolution.importOffer(pending.text, { baselineGeneration: pending.baselineGeneration, signal: controller.signal });
        pending = null; preview.hidden = true; fileInput.value = '';
        status(candidate.status === 'awaiting-approval' ? 'Local tests passed. Review the candidate before choosing Use this version.'
          : 'Candidate not ready for adoption. Its local test result is retained below.');
      }
      if (!controller.signal.aborted) await onUpdated();
    } catch (error) { status(error.message); }
    finally { evaluating = false; if (!controller.signal.aborted) { button.disabled = false; refresh(); } }
  }, { signal: controller.signal });
  const unsubscribe = application.subscribe(refresh);
  refresh();
  return () => { selection++; controller.abort(); unsubscribe(); };
}
