// These functions execute on the coordinator's isolated qualification page.
export async function encodeTrainingTickets(rows) {
  const { DOPPLER_MODULE_URL } = await import('/config/doppler-local-models.js');
  const policy = await (await fetch('/config/lora-training.json')).json();
  const baseUrl = new URL(policy.modelPath, location.origin);
  const { Tokenizer } = await import(new URL('inference/tokenizer.js', new URL(DOPPLER_MODULE_URL, location.href)));
  const manifestResponse = await fetch(new URL('manifest.json', baseUrl));
  if (!manifestResponse.ok) throw Error('Training model manifest unavailable');
  const manifest = await manifestResponse.json();
  const tokenizer = new Tokenizer();
  await tokenizer.initialize(manifest, { baseUrl: baseUrl.href.replace(/\/$/, '') });
  if (tokenizer.encode('').length) throw Error('Training tokenizer inserted special tokens');
  return rows.map(({ id, prompt, label }) => {
    const inputIds = Array.from(tokenizer.encode(prompt));
    const tokens = Object.fromEntries(['A', 'B'].map(choice => {
      const extended = tokenizer.encode(prompt + choice), bare = tokenizer.encode(choice);
      if (bare.length !== 1 || extended.length !== inputIds.length + 1 || extended.at(-1) !== bare[0]
        || !inputIds.every((value, index) => value === extended[index])) throw Error('Unaligned label token for ' + id);
      return [choice, bare[0]];
    }));
    if (tokens.A === tokens.B || !Object.hasOwn(tokens, label) || !inputIds.length) throw Error('Invalid training labels');
    const targetIds = Array(inputIds.length).fill(-100);
    targetIds[targetIds.length - 1] = tokens[label];
    return { id, tokens, sample: { inputIds, targetIds, supervisedTokenCount: 1 } };
  });
}

// Keep the two differently worded sequences independent. Concatenating them changes
// causal attention. Here both gradients use the same local GPU and optimizer checkpoint.
export async function trainTicketReference({ rounds, adapter }) {
  const { DOPPLER_TRAINING_URL } = await import('/config/doppler-local-models.js');
  const policy = await (await fetch('/config/lora-training.json')).json();
  const api = await import(DOPPLER_TRAINING_URL);
  const modelUrl = new URL(policy.modelPath, location.origin).href;
  const loaded = await api.loadNativeQwenTrainingPipeline(modelUrl);
  let trainer;
  try {
    trainer = api.createNativeQwenLoRATrainer({ ...policy.trainer, pipeline: loaded.pipeline,
      baseModelId: policy.modelId, layerIdx: policy.layerIdx, module: policy.module });
    const metrics = [], parentHashes = [];
    for (const [index, samples] of rounds.entries()) {
      const assignments = samples.map((sample, side) => trainer.describeTrainingSample('local-sample-' + side, sample));
      const round = await trainer.createTrainingRound({ jobId: 'single-host-reference', roundId: String(index), assignments });
      if (round.baseManifestHash !== policy.baseManifestHash || round.checkpoint.stepCount !== index) throw Error('Reference checkpoint mismatch');
      const contributions = [];
      for (const [side, sample] of samples.entries()) {
        contributions.push(await trainer.computeGradientContribution(round, assignments[side].participantId, sample));
      }
      metrics.push(await trainer.applyGradientContributions(round, contributions));
      parentHashes.push(round.checkpointHash);
    }
    const final = await trainer.createTrainingRound({ jobId: 'single-host-reference', roundId: 'checkpoint',
      assignments: [trainer.describeTrainingSample('local-sample-0', rounds[0][0])] });
    const value = await trainer.exportAdapter({ ...adapter, weightsPath: 'adapter.safetensors', metadata: {
      mode: 'single-host-token-weighted-reference', checkpointHash: final.checkpointHash,
      checkpointStep: final.checkpoint.stepCount, evaluated: false, activated: false
    } });
    return { ...value, weights: Array.from(new Uint8Array(value.weights)), metrics, parentHashes,
      evaluated: false, activated: false };
  } finally { trainer?.dispose(); await loaded.pipeline.unload(); }
}
