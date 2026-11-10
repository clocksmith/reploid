/**
 * @fileoverview Signed review claims: accept, reject, correct or request replication. Accepting
 * cross-room evidence requires an explicit relevant context determination.
 */
import { createSignedHumanClaim } from '../../pool/evidence-network.js';

export const reviewActionClaims = Object.freeze({
  accept: {
    claimKind: 'review_decision',
    relation: 'reviews',
    decision: 'accepted',
    pending: 'Signing acceptance...'
  },
  reject: {
    claimKind: 'review_decision',
    relation: 'reviews',
    decision: 'rejected',
    pending: 'Signing rejection...'
  },
  correct: {
    claimKind: 'correction',
    relation: 'corrects',
    decision: null,
    pending: 'Signing correction...'
  },
  replicate: {
    claimKind: 'review_decision',
    relation: 'reviews',
    decision: 'replication_requested',
    pending: 'Signing replication request...'
  }
});

export const createContextualReviewRecord = ({
  action,
  identity,
  roomId,
  targetHash,
  text,
  confidence,
  evidenceUrl = '',
  targetRecord = null,
  contextDetermination = ''
} = {}) => {
  const claim = reviewActionClaims[action];
  if (!claim) throw new TypeError('review action must be accept, reject, correct, or replicate');
  const reuseContext = targetRecord?.evidence?.reuseContext || null;
  const determination = String(contextDetermination || '').trim();
  if (reuseContext && action === 'accept' && determination !== 'relevant') {
    throw new TypeError('Accepting cross-room evidence requires an explicit relevant context determination');
  }
  const contextAssessment = reuseContext && claim.claimKind === 'review_decision' && determination
    ? {
        determination,
        originRecordHash: reuseContext.originRecordHash,
        originQuestionHash: reuseContext.origin.questionHash,
        currentQuestionHash: reuseContext.current.questionHash,
        comparisonHash: reuseContext.comparisonHash,
        rationale: text
      }
    : null;
  return createSignedHumanClaim({
    identity,
    roomId,
    targetHash,
    claimKind: claim.claimKind,
    relation: claim.relation,
    text,
    confidence,
    evidenceLinks: evidenceUrl ? [evidenceUrl] : [],
    decision: claim.decision,
    contextAssessment
  });
};
