/**
 * @fileoverview Research Room-1 actions: replay checkpoints, prior-room evidence attachment,
 * exact candidate and task approvals, and loading the canonical sample dispute.
 */
import { createPoolIdentity } from '../../../../shared/pool/identity.js';
import { createDiscoveryContractCheckpoint } from '../../pool/discovery-contract.js';
import {
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  activeResearchRecords,
  createCrossRoomReuseContext,
  createSignedHumanClaim,
  createSignedPriorEvidence,
  createSignedPublicProteinEvidence,
  createSignedResearchSubmission,
  proposeDiscoveryTasks,
  rankProposedCandidateActions
} from '../../pool/evidence-network.js';
import { getEnabledPoolModelContract } from '../../../../shared/pool/model-contract.js';
import { getCrossRoomSequenceEvidence, loadResearchRecords, publishResearchRecord } from './research-store.js';

export async function createCurrentRoomPriorEvidence({
  identity,
  roomId,
  question,
  originQuestion,
  candidate,
  sourceRecord,
  createdAt = new Date().toISOString()
} = {}) {
  if (question?.kind !== 'research_submission' || question.roomId !== roomId) {
    throw new Error('The active current-room question is unavailable');
  }
  if (candidate?.originRoomId === roomId || candidate?.recordHash !== sourceRecord?.recordHash) {
    throw new Error('The prior-room candidate identity is inconsistent');
  }
  if (originQuestion?.kind !== 'research_submission'
    || originQuestion.recordHash !== sourceRecord?.questionHash
    || originQuestion.roomId !== candidate.originRoomId) {
    throw new Error('The signed origin-room question is unavailable or inconsistent');
  }
  if (candidate?.qualification?.status !== 'source_metadata_complete') {
    throw new Error('The prior-room source requires qualification before attachment');
  }
  if (sourceRecord?.kind !== 'research_prior_evidence') {
    throw new Error('Only a versioned prior-evidence record can be attached automatically');
  }
  const license = String(sourceRecord.evidence?.provenance?.license || '').trim();
  if (!license) throw new Error('The prior-room source has no declared reuse license');
  const annotation = sourceRecord.evidence?.annotation || null;
  if (['annotation', 'domain'].includes(sourceRecord.evidence?.kind)) {
    if (!annotation) throw new Error('The prior-room annotation has no normalized identity');
    if (annotation.sequence?.hash !== question.sequence?.hash
      || annotation.sequence?.length !== question.sequence?.length) {
      throw new Error('The prior-room annotation is not bound to the active exact sequence');
    }
  }
  const reuseContext = await createCrossRoomReuseContext({
    originRecord: sourceRecord,
    originQuestion,
    currentQuestion: question
  });
  const createAttachedEvidence = sourceRecord.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION
    ? createSignedPublicProteinEvidence
    : createSignedPriorEvidence;
  return createAttachedEvidence({
    identity,
    roomId,
    questionHash: question.recordHash,
    evidenceKind: sourceRecord.evidence?.kind,
    summary: `Prior-room evidence from ${candidate.originRoomId}: ${sourceRecord.evidence?.summary || candidate.recordHash}`,
    reference: {
      accession: `reploid:${candidate.originRoomId}:${sourceRecord.evidence?.reference?.accession || 'evidence'}`,
      contentHash: candidate.recordHash
    },
    annotation,
    reuseContext,
    conditions: sourceRecord.evidence?.conditions || {},
    transformations: [
      ...(sourceRecord.evidence?.transformations || []),
      {
        id: 'reploid.cross-room-evidence-reference',
        version: '1',
        description: 'References the exact signed origin-room record without inheriting its decision status.'
      }
    ],
    uncertainty: sourceRecord.evidence?.uncertainty || {},
    finding: sourceRecord.evidence?.finding || {},
    provenance: {
      retrievalMethod: 'Reploid exact-sequence prior-room lookup',
      retrievedAt: createdAt,
      sourceIdentity: `${candidate.originRoomId}:${candidate.recordHash}`,
      license
    },
    createdAt
  });
}

export function bindResearchRoomActions(root = document, {
  publishRecord = publishResearchRecord
} = {}) {
  if (!root || root.dataset?.researchRoomActionsBound === 'true') return;
  if (root.dataset) root.dataset.researchRoomActionsBound = 'true';
  root.addEventListener('click', async (event) => {
    const checkpointButton = event.target.closest?.('[data-pool-room-freeze-contract]');
    if (checkpointButton && root.contains(checkpointButton)) {
      event.preventDefault();
      const roomId = checkpointButton.dataset.poolRoomId;
      const records = loadResearchRecords(roomId);
      const question = activeResearchRecords(records)
        .filter((record) => record.kind === 'research_submission')
        .at(-1) || null;
      const parent = records
        .filter((record) => (
          record.kind === 'research_discovery_checkpoint'
          && record.checkpoint?.questionHash === question?.recordHash
        ))
        .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))
          || left.recordHash.localeCompare(right.recordHash))
        .at(-1) || null;
      const label = checkpointButton.textContent;
      checkpointButton.disabled = true;
      checkpointButton.textContent = 'Signing replay checkpoint...';
      try {
        if (!question) throw new Error('The active Research Room question is unavailable');
        const record = await createDiscoveryContractCheckpoint({
          identity: createPoolIdentity('reviewer'),
          roomId,
          questionHash: question.recordHash,
          records,
          parentCheckpointHashes: parent ? [parent.recordHash] : []
        });
        const publication = await publishRecord(record, { roomId });
        checkpointButton.textContent = publication.remote ? 'Checkpoint synchronized' : 'Checkpoint saved locally';
      } catch (error) {
        checkpointButton.disabled = false;
        checkpointButton.textContent = label;
        checkpointButton.title = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    const priorButton = event.target.closest?.('[data-pool-room-attach-prior]');
    if (priorButton && root.contains(priorButton)) {
      event.preventDefault();
      const roomId = priorButton.dataset.poolRoomId;
      const recordHash = priorButton.dataset.poolRoomAttachPrior;
      const originRoomId = priorButton.dataset.poolRoomPriorOrigin;
      const state = getCrossRoomSequenceEvidence(roomId);
      const candidate = state.projection?.candidates?.find((entry) => (
        entry.recordHash === recordHash && entry.originRoomId === originRoomId
      ));
      const sourceRecord = state.projection?.records?.find((entry) => entry.recordHash === recordHash);
      const originQuestion = state.projection?.records?.find((entry) => (
        entry.recordHash === sourceRecord?.questionHash
        && entry.kind === 'research_submission'
        && entry.roomId === originRoomId
      ));
      const question = activeResearchRecords(loadResearchRecords(roomId))
        .filter((record) => record.kind === 'research_submission')
        .at(-1) || null;
      const label = priorButton.textContent;
      priorButton.disabled = true;
      priorButton.textContent = 'Signing provisional evidence...';
      try {
        if (!candidate || !sourceRecord) throw new Error('The prior-room candidate is no longer available');
        if (state.sequenceHash !== question?.sequence?.hash) throw new Error('The prior-room sequence identity is stale');
        const record = await createCurrentRoomPriorEvidence({
          identity: createPoolIdentity('researcher'),
          roomId,
          question,
          originQuestion,
          candidate,
          sourceRecord
        });
        const publication = await publishRecord(record, { roomId });
        priorButton.textContent = publication.remote ? 'Attached for review' : 'Attached locally; sync pending';
      } catch (error) {
        priorButton.disabled = false;
        priorButton.textContent = label;
        priorButton.title = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    const candidateButton = event.target.closest?.('[data-pool-room-approve-candidate]');
    if (candidateButton && root.contains(candidateButton)) {
      event.preventDefault();
      const roomId = candidateButton.dataset.poolRoomId;
      const recordHash = candidateButton.dataset.poolRoomApproveCandidate;
      const contractHash = candidateButton.dataset.poolRoomCandidateContract;
      const records = loadResearchRecords(roomId);
      const candidate = activeResearchRecords(records).find((record) => (
        record.kind === 'research_candidate_action'
        && record.recordHash === recordHash
        && record.action?.contractHash === contractHash
      ));
      const admitted = rankProposedCandidateActions(records).admittedCandidates
        .some((entry) => entry.recordHash === recordHash && entry.actionId === contractHash);
      const label = candidateButton.textContent;
      candidateButton.disabled = true;
      candidateButton.textContent = 'Signing exact approval...';
      try {
        if (!candidate || !admitted) throw new Error('The signed candidate action is no longer admitted');
        const approval = await createSignedHumanClaim({
          identity: createPoolIdentity('reviewer'),
          roomId,
          targetHash: candidate.recordHash,
          claimKind: 'candidate_action_approval',
          relation: 'approves',
          text: `Approved exact candidate action contract: ${contractHash}`,
          confidence: 1,
          decision: 'approved',
          actionContractHash: contractHash
        });
        const publication = await publishRecord(approval, { roomId });
        candidateButton.textContent = publication.remote ? 'Exact contract approved' : 'Approval saved locally';
      } catch (error) {
        candidateButton.disabled = false;
        candidateButton.textContent = label;
        candidateButton.title = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    const button = event.target.closest?.('[data-pool-room-approve-task]');
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    const taskId = button.dataset.poolRoomApproveTask;
    const roomId = button.dataset.poolRoomId;
    const targetHash = button.dataset.poolRoomTaskTarget;
    if (!taskId || !roomId || !targetHash) return;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Signing approval...';
    try {
      const task = proposeDiscoveryTasks(loadResearchRecords(roomId))
        .find((candidate) => candidate.taskId === taskId && candidate.targetHash === targetHash);
      if (!task) throw new Error('The projected discovery task is no longer active');
      const record = await createSignedHumanClaim({
        identity: createPoolIdentity('reviewer'),
        roomId,
        targetHash,
        claimKind: 'task_approval',
        relation: 'approves',
        text: `Approved bounded discovery task: ${taskId}`,
        confidence: 1,
        decision: 'approved',
        taskId,
        taskContract: task.taskContract
      });
      const publication = await publishRecord(record, { roomId });
      button.textContent = publication.remote ? 'Approved next action' : 'Approval saved locally';
    } catch (error) {
      button.disabled = false;
      button.textContent = label;
      button.title = error instanceof Error ? error.message : String(error);
    }
    return;
  });

  root.addEventListener('click', async (event) => {
    const sampleButton = event.target.closest?.('[data-pool-load-sample-dispute]');
    if (!sampleButton || !root.contains(sampleButton)) return;
    event.preventDefault();
    const roomId = sampleButton.dataset.poolRoomId;
    const label = sampleButton.textContent;
    sampleButton.disabled = true;
    sampleButton.textContent = 'Loading canonical dispute...';
    try {
      const canonicalSequence = 'MFVFLVLLPLVSSQCVNLTTRTQLPPAYTNSFTRGVYYPDKVFRSSVLHSTQDLFLPFFSNVTWFHAIHVSGTNGTKRFDNPVLPFNDGVYFASTEKSNIIRGWIFGTTLDSKTQSLLIVNNATNVVIKVCEFQFCNDPFLGVYYHKNNKSWMESEFRVYSSANNCTFEYVSQPFLMDLEGKQGNFKNLREFVFKNIDGYFKIYSKHTPINLVRDLPQGFSALEPLVDLPIGINITRFQTLLALHRSYLTPGDSSSGWTAGAAAYYVGYLQPRTFLLKYNENGTITDAVDCALDPLSETKCTLKSFTVEKGIYQTSNFRVQPTESIVRFPNITNLCPFGEVFNATRFASVYAWNRKRISNCVADYSVLYNSASFSTFKCYGVSPTKLNDLCFTNVYADSFVIRGDEVRQIAPGQTGKIADYNYKLPDDFTGCVIAWNSNNLDSKVGGNYNYLYRLFRKSNLKPFERDISTEIYQAGSTPCNGVEGFNCYFPLQSYGFQPTNGVGYQPYRVVVLSFELLHAPATVCGPKKSTNLVKNKCVNFNFNGLTGTGVLTESNKKFLPFQQFGRDIADTTDAVRDPQTLEILDITPCSFGGVSVITPGTNTSNQVAVLYQDVNCTEVPVAIHADQLTPTWRVYSTGSNVFQTRAGCLIGAEHVNNSYECDIPIGAGICASYQTQTNSPRRARSVASQSIIAYTMSLGAENSVAYSNNSIAIPTNFTISVTTEILPVSMTKTSVDCTMYICGDSTECSNLLLQYGSFCTQLNRALTGIAVEQDKNTQEVFAQVKQIYKTPPIKDFGGFNFSQILPDPSKPSKRSFIEDLLFNKVTLADAGFIKQYGDCLGDIAARDLICAQKFNGLTVLPPLLTDEMIAQYTSALLAGTITSGWTFGAGAALQIPFAMQMAYRFNGIGVTQNVLYENQKLIANQFNSAIGKIQDSLSSTASALGKLQDVVNQNAQALNTLVKQLSSNFGAISSVLNDILSRLDKVEAEVQIDRLITGRLQSLQTYVTQQLIRAAEIRASANLAATKMSECVLGQSKRVDFCGKGYHLMSFPQSAPHGVVFLHVTYVPAQEKNFTTAPAICHDGKAHFPREGVFVSNGTHWFVTQRNFYEPQIITTDNTFVSGNCDVVIGIVNNTVYDPLQPELDSFKEELDKYFKNHTSPDVDLGDISGINASVVNIQKEIDRLNEVAKNLNESLIDLQELGKYEQYIKWPWYIWLGFIAGLIAIVMVTIMLCCMTSCCSCLKGCCSCGSCCKFDEDDSEPVLKGVKLHYT';
      const modelContract = getEnabledPoolModelContract() || {
        id: 'esm2-t12-35m-ur50d-f32-af32',
        hash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        manifestHash: 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        workload: 'sequence.embedding.v1',
        executionMode: 'full_model_browser_sequence'
      };
      const submission = await createSignedResearchSubmission({
        identity: createPoolIdentity('requester'),
        roomId,
        sequence: {
          alphabet: 'amino_acid',
          value: canonicalSequence
        },
        consent: {
          publicSequence: true,
          publicEvidenceNetwork: true,
          publishEmbedding: true,
          publishResidueEvidence: true
        },
        requesterIntent: {
          kind: 'question',
          label: 'Adjudicate Spike RBD domain boundary (UniProt:P0DTC2 vs InterPro:IPR043506)',
          text: 'Does ESM-2 35M residue-level embedding match the curated 319-541 RBD boundary or extend into the N-terminal linker?'
        },
        modelContract,
        policyId: 'redundant_agreement'
      });
      await publishRecord(submission, { roomId });
      sampleButton.textContent = 'Canonical dispute loaded';
      if (typeof globalThis.location?.reload === 'function') {
        globalThis.location.reload();
      }
    } catch (error) {
      sampleButton.disabled = false;
      sampleButton.textContent = label;
      sampleButton.title = error instanceof Error ? error.message : String(error);
    }
  });
}
