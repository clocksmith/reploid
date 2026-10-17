/** Training controls render host-owned state. Export never activates an adapter. */
export function renderTraining() {
  return `<details class="pool-disclosure" data-lora-panel><summary>Train a LoRA adapter</summary>
    <div class="pool-stack pool-gap-md">
      <p class="pool-body">Train Qwen3.5 0.8B’s final down projection on your examples. Individual training stays on this device. A pooled round shares checkpoints and gradients with selected participants; gradients can reveal information about training data.</p>
      <p class="pool-caption">Use up to eight tokenized samples with inputIds, targetIds and supervisedTokenCount, at most 128 tokens each. Pooled training uses one sample per participant. Model preparation may download weights. Exported adapters still need independent quality evaluation.</p>
      <label class="pool-stack">Training samples (.json)<input type="file" accept=".json,application/json" data-lora-file></label>
      <label class="pool-stack">Adapter ID<input class="pool-input" data-lora-id value="my-qwen-adapter" maxlength="96"></label>
      <label class="pool-stack">Version<input class="pool-input" data-lora-version value="0.0.1"></label>
      <label><input type="checkbox" data-lora-consent> Allow model preparation and training on these samples. For pooled training, allow gradient and checkpoint exchange with the participants selected below.</label>
      <div class="pool-row pool-gap-xs">
        <button type="button" class="pool-button" data-lora-local>Train on this device</button>
        <button type="button" class="pool-button" data-lora-stop>Stop training</button>
      </div>
      <details class="pool-disclosure"><summary>Train with connected participants</summary>
        <p class="pool-caption">Open this panel on each device and connect training. Contributors select the coordinator and enable one round. The coordinator selects those ready contributors and starts the round. A missing contribution fails the round without a partial optimizer update.</p>
        <button type="button" class="pool-button" data-lora-connect>Connect training</button>
        <label class="pool-stack">Coordinator (when contributing)<select class="pool-select" data-lora-coordinator><option value="">Connect first</option></select></label>
        <div class="pool-stack" data-lora-peers></div>
        <div class="pool-row pool-gap-xs"><button type="button" class="pool-button" data-lora-share>Contribute one round</button>
        <button type="button" class="pool-button" data-lora-pool>Train with selected participants</button></div>
      </details>
      <p class="pool-body" role="status" aria-live="polite" data-lora-status>Training is idle.</p>
      <p class="pool-body" role="alert" data-lora-error></p>
      <div class="pool-row pool-gap-xs" data-lora-downloads hidden>
        <button type="button" class="pool-button" data-lora-manifest>Download adapter.json</button>
        <button type="button" class="pool-button" data-lora-weights>Download adapter.safetensors</button>
      </div>
    </div></details>`;
}

export function bindTraining(root, training) {
  if (!training || !root.querySelector('[data-lora-panel]')) return () => {};
  const events = new AbortController(), options = { signal: events.signal };
  const find = name => root.querySelector(`[data-lora-${name}]`);
  let samples = null, exported = training.getCandidate(), reading = false, revision = 0;
  const fail = error => { if (!events.signal.aborted) find('error').textContent = error.message; };
  const action = task => { find('error').textContent = ''; Promise.resolve().then(task).catch(fail); };
  const state = value => {
    const busy = value.busy;
    find('status').textContent = `${value.phase}: ${value.message || 'Training is idle.'}`;
    for (const name of ['local', 'share', 'pool', 'file']) find(name).disabled = busy || reading;
    if (value.phase === 'completed') { exported = training.getCandidate(); find('downloads').hidden = !exported; }
    if (value.phase === 'preparing') { exported = null; find('downloads').hidden = true; }
  };
  const unsubscribe = training.subscribe(state);
  find('file').addEventListener('change', async event => {
    const file = event.target.files[0], current = ++revision; samples = null;
    if (!file) return;
    reading = true; state(training.getState());
    try {
      if (file.size > training.policy.maxInputBytes) throw new Error('Training file exceeds the input allowance');
      const parsed = JSON.parse(await file.text());
      if (events.signal.aborted || current !== revision) return;
      samples = Array.isArray(parsed) ? parsed : parsed.samples;
      if (!Array.isArray(samples) || !samples.length) throw new Error('Choose a JSON array of tokenized training samples');
      find('status').textContent = `${samples.length} training samples selected`;
    } catch (error) { samples = null; fail(error); }
    finally { reading = false; if (!events.signal.aborted) state(training.getState()); }
  }, options);
  const request = () => {
    if (!samples || reading) throw new Error('Choose training samples first');
    return { samples, consent: find('consent').checked,
      adapter: { id: find('id').value.trim(), name: find('id').value.trim(), version: find('version').value.trim() } };
  };
  const run = peers => action(async () => {
    if (peers && !peers.length) throw new Error('Select at least one contributor');
    exported = await training.run({ ...request(), peers: peers || [] });
    if (!events.signal.aborted) find('downloads').hidden = false;
  });
  find('local').addEventListener('click', () => run(), options);
  find('pool').addEventListener('click', () => run([...root.querySelectorAll('[data-lora-peer]:checked')].map(node => node.value)), options);
  find('stop').addEventListener('click', () => action(() => training.stop()), options);
  find('connect').addEventListener('click', () => action(async () => {
    await training.connect(); if (events.signal.aborted) return;
    const option = (label, value) => {
      const node = document.createElement('option'); node.textContent = label; node.value = value; return node;
    };
    find('coordinator').replaceChildren(option('Choose coordinator', '')); find('peers').replaceChildren();
    for (const peer of training.peers()) {
      find('coordinator').append(option(peer.name, peer.id));
      const label = document.createElement('label'), checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.value = peer.id; checkbox.dataset.loraPeer = '';
      label.append(checkbox, document.createTextNode(` ${peer.name}`)); find('peers').append(label);
    }
  }), options);
  find('share').addEventListener('click', () => action(() => {
    const input = request();
    if (input.samples.length !== 1 || !find('coordinator').value) throw new Error('Choose one sample and a coordinator');
    return training.contribute({ sample: input.samples[0], coordinator: find('coordinator').value, consent: input.consent });
  }), options);
  const download = (filename, content, type) => {
    const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  find('manifest').addEventListener('click', () => { if (exported) download('adapter.json', exported.json, 'application/json'); }, options);
  find('weights').addEventListener('click', () => { if (exported) download('adapter.safetensors', exported.weights, 'application/octet-stream'); }, options);
  return () => { events.abort(); revision++; unsubscribe(); };
}
