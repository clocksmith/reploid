// Physical installed-package decisions. No UI or synthetic model computation.
import * as runtime from 'doppler-gpu';
import * as compat from 'doppler-gpu/compat';

let model, submittedController;
const devices = [], destroyed = new WeakSet();
function requireValue(value, message) { if (!value) throw new Error(message); }
export async function qualify({ modelUrl, reference, contract }) {
  const report = { passed: false, cases: [], checks: [] };
  const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter = async descriptor => {
    const adapter = await requestAdapter(descriptor);
    const requestDevice = adapter.requestDevice.bind(adapter);
    adapter.requestDevice = async options => {
      const device = await requestDevice(options);
      const submit = device.queue.submit.bind(device.queue), destroy = device.destroy.bind(device);
      device.queue.submit = commands => {
        const result = submit(commands), controller = submittedController;
        submittedController = null;
        controller?.abort(new Error('Cancelled after real browser GPU submission'));
        return result;
      };
      device.destroy = () => { destroyed.add(device); return destroy(); };
      devices.push(device); return device;
    };
    return adapter;
  };
  try {
    model = await compat.load({ url: modelUrl }, { cache: false, isolatedLoader: true });
    report.deviceInfo = model.deviceInfo;
    requireValue(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(model.deviceInfo)), 'Physical GPU required');
    const request = row => ({ prompt: row.prompt, choices: contract.choices, maxSeqLen: contract.maxSeqLen });
    for (const row of reference.cases) {
      const input = request(row);
      const output = runtime.validateChoiceScoringResult(input, await model.scoreChoices(input));
      const promptTokenIds = model.advanced.tokenizePrompt(row.prompt, { useChatTemplate: false });
      const maximumAbsoluteLogitError = Math.max(...output.choices.map((choice, index) => Math.abs(choice.logit - row.logits[index])));
      const passed = output.selectedId === row.expectedId && output.selectedId === row.selectedId
        && maximumAbsoluteLogitError <= contract.maximumAbsoluteLogitError
        && JSON.stringify(promptTokenIds) === JSON.stringify(row.promptTokenIds)
        && output.choices.every((choice, index) => choice.tokenId === row.tokenIds[index]);
      report.cases.push({ id: row.id, input, output, promptTokenIds, expectedId: row.expectedId, maximumAbsoluteLogitError, passed });
      console.log(JSON.stringify({ id: row.id, passed, maximumAbsoluteLogitError }));
    }
    const controller = new AbortController(); submittedController = controller;
    let cancelled = false;
    try { await model.scoreChoices(request(reference.cases[0]), { signal: controller.signal }); }
    catch (error) { cancelled = /Cancelled after real browser/.test(error.message); }
    requireValue(cancelled && controller.signal.aborted, 'Submitted cancellation did not propagate');
    for (const device of devices) if (!destroyed.has(device)) await device.queue.onSubmittedWorkDone();
    report.checks.push({ id: 'cancel-after-submission-settled', passed: true });
    const reused = await model.scoreChoices(request(reference.cases[0]));
    requireValue(reused.selectedId === reference.cases[0].expectedId, 'Cancellation poisoned subsequent scoring');
    report.checks.push({ id: 'resident-reuse-after-cancellation', passed: true });
    report.correctChoices = report.cases.filter(row => row.output.selectedId === row.expectedId).length;
    report.passed = report.cases.every(row => row.passed) && report.correctChoices >= contract.minimumCorrectChoices;
  } catch (error) { report.failure = String(error.stack || error); }
  finally {
    try { await model?.unload(); for (const device of devices) if (!destroyed.has(device)) device.destroy();
      report.checks.push({ id: 'weights-unloaded-and-devices-destroyed', passed: true }); }
    catch (error) { report.cleanupFailure = String(error.stack || error); report.passed = false; }
    navigator.gpu.requestAdapter = requestAdapter;
  }
  return report;
}
