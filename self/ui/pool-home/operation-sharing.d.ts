import type { OperationParticipation, OperationParticipationState } from '../../pool/operation-participation.js';
export function renderOperationSharing(): string;
export function refreshOperationSharing(root: ParentNode, state: OperationParticipationState): void;
export function bindOperationSharing(root: ParentNode, participation: OperationParticipation): () => void;
