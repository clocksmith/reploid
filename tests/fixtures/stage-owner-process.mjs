// Child of the private fleet settlement test. The sampler is deterministic; all admission,
// receipts, persistence, HTTP service calls and process termination are real.
import fs from 'node:fs/promises';
import { openStageOwner } from '../../server/fleet/stage-owner.js';
import { createFleetClient } from '../../server/fleet/service.js';
import { createFleetExecutionAdmission, bindFleetStageAdmission } from '../../server/fleet/execution-admission.js';
import { openStageReceipts, createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';

const cfg = JSON.parse(await fs.readFile(process.argv[2]));
const key = JSON.parse(await fs.readFile(cfg.identityFile));
const signer = createAttemptEvidenceSigner({ identity: key });
let dropClosingReply = false;
const credits = createFleetClient({ url: cfg.serviceUrl, identity: key, outboxFile: cfg.identityFile + '.outbox',
  fetchImpl: async (url, opts) => {
    const res = await fetch(url, opts);
    if (dropClosingReply && JSON.parse(opts.body).operation === 'collect') {
      await res.arrayBuffer(); throw Error('Fixture dropped the accepted terminal reply');
    }
    return res;
  } });
let owner, tally, resident;
async function command(op, payload) {
  if (op === 'open') {
    owner = await openStageOwner({ file: cfg.identityFile + '.stage-owner.sqlite', serviceUrl: cfg.serviceUrl,
      roomId: cfg.roomId, participantId: key.peerId });
    const admission = createFleetExecutionAdmission({ credits, stageOwner: owner, model: cfg.model });
    resident = bindFleetStageAdmission({
      async reserve(req) { tally = await openStageReceipts({ signer, identity: req.identity, partitionIndex: cfg.index, charge: req.charge }); },
      async executeStage(req) { return { delta: 'x', receipt: await tally.step({ step: req.step, inputTokenCount: 1, delta: 'x', done: req.done, stopReason: req.done ? 'eos' : null }) }; },
      async finish() {
        await tally.close();
        await admission.partitionReceipt(tally.evidence());
      }
    }, admission, cfg.index);
    return true;
  }
  if (op === 'reserve') { await resident.reserve(payload); return true; }
  if (op === 'step') return resident.executeStage(payload);
  if (op === 'lose-reply') { dropClosingReply = true; return resident.finish(); }
  if (op === 'recover') return owner.recover(credits);
  if (op === 'close') { await owner?.close(); return true; }
  throw Error('Unknown test command');
}
process.on('message', async msg => {
  try { process.send({ result: await command(msg.op, msg.payload) }); }
  catch (error) { process.send({ error: error.message }); }
});
