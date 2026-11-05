import type { DocumentChunk } from './document-search.js';
export function buildDocumentAnswerPrompt(options: {
  question: string; passages: readonly { text: string }[]; abstention: string; unknown: string;
  remoteDraft?: string | null; remoteDraftInstruction?: string;
}): string;
export interface DocumentAnswerInspection {
  status: 'abstained' | 'cited' | 'invalid';
  support: 'not-evaluated';
  citations: readonly number[];
  claims: readonly { start: number; end: number; text: string; kind: 'factual' | 'unknown'; citations: readonly number[];
    passages: readonly (DocumentChunk & { number: number })[]; support: 'not-evaluated' }[];
  errors: readonly string[];
}
export function inspectDocumentAnswer(options: {
  text: string; passages: readonly DocumentChunk[]; abstention: string; unknown?: string;
}): DocumentAnswerInspection;
