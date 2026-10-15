export interface RetrievalLimits {
  /** Sources kept from the provider's results, in provider order. */
  maxResults: number;
  /** Characters of passage text kept per source. */
  maxSourceCharacters: number;
  /** Characters of the complete numbered context, instructions included. */
  maxContextCharacters: number;
  /** Search plus extraction; a provider that ignores its signal cannot extend it. */
  timeoutMs: number;
}
export interface SearchResult {
  /** Stable provider identifier of the source. */
  sourceId: string;
  url: string;
  title: string;
  /** Retrieved text; used as the passage when no extractor is configured. */
  excerpt: string;
  retrievedAt: number;
  /** Provider-attested sha256 of the content it retrieved. */
  contentHash: string;
}
/** A search provider. The host owns its credentials, terms and any disclosure of the query to it. */
export interface SearchProvider {
  id: string; version: string;
  search(query: string, limits: RetrievalLimits, signal: AbortSignal): Promise<SearchResult[]>;
}
export interface ExtractedPassage { sourceId: string; url?: string; text: string; retrievedAt: number; contentHash: string }
/** Fetches a source and extracts the passage text relevant to the query. */
export interface PassageExtractor {
  id: string; version: string;
  extract(input: { source: SearchResult; query: string; limits: RetrievalLimits; signal: AbortSignal }): Promise<ExtractedPassage>;
}
export type SupportVerdict = 'supported' | 'unsupported' | 'unverified';
export interface SupportJudgment { verdict: SupportVerdict; reason: string }
/** Judges whether one retrieved passage states or directly entails one claim. Its judgments need their own qualification. */
export interface SupportChecker {
  id: string; version: string; qualified?: boolean;
  check(input: { claim: string; source: { number: number; sourceId: string; title: string; url: string; passage: string };
    signal: AbortSignal | null }): Promise<SupportJudgment>;
}
export interface RetrievalRequest { query: string; limits: RetrievalLimits }
export interface RetrievalRequestInput { query?: string; limits?: Partial<RetrievalLimits> }
export type RetrievalOutcome = 'pending' | 'retrieved' | 'empty' | 'failed' | 'cancelled' | 'interrupted';
export type RetrievalErrorCode = 'no-results' | 'timeout' | 'provider-error' | 'invalid-provider-result' | 'extraction-failed'
  | 'context-limit' | 'cancelled' | 'interrupted';
export interface RetrievedSource {
  /** The citation marker number in the context sent with the question. */
  number: number;
  sourceId: string; url: string; title: string; retrievedAt: number; contentHash: string;
  /** Exactly the passage text sent; passageHash is its sha256. */
  passage: string; passageHash: string; passageOrigin: 'extract' | 'search-excerpt'; truncated: boolean;
}
export interface CitationClaim {
  index: number; start: number; end: number; text: string; markers: number[]; cited: boolean;
  citations: Array<{ marker: number; sourceId: string | null; resolved: boolean; support: SupportJudgment | null }>;
}
export type CitationFlag =
  | { kind: 'uncited-claim'; claim: number }
  | { kind: 'unresolved-citation'; claim: number; marker: number }
  | { kind: 'unsupported-citation'; claim: number; marker: number; reason: string }
  | { kind: 'unverified-support'; claim: number; marker: number }
  | { kind: 'unresolved-reference'; marker: number }
  | { kind: 'mismatched-reference'; marker: number; url: string }
  | { kind: 'unrecorded-url'; url: string };
export interface CitationVerification {
  schema: 'reploid.citation-verification/v1';
  checker: { id: string; version: string } | null;
  claims: CitationClaim[];
  references: Array<{ start: number; end: number; markers: number[]; text: string; unresolved: number[] }>;
  unrecordedUrls: string[];
  flags: CitationFlag[];
  summary: { claims: number; citedClaims: number; uncitedClaims: number; citations: number; unresolvedCitations: number;
    supported: number; unsupported: number; unverified: number; unrecordedUrls: number };
}
export interface RetrievalRecord {
  schema: 'reploid.retrieval-record/v1';
  policy: { id: string; version: string };
  provider: { id: string; version: string };
  extractor: { id: string; version: string } | null;
  sourceUse: 'requester-opt-in';
  query: string; limits: RetrievalLimits;
  outcome: RetrievalOutcome; error: { code: RetrievalErrorCode; message: string } | null;
  startedAt: number; finishedAt: number | null; providerResultCount: number | null;
  sources: RetrievedSource[];
  omitted: Array<{ sourceId: string; reason: 'result-limit' | 'extraction-failed' | 'context-limit' }>;
  context: { schema: string; characters: number; digest: string } | null;
  verification: CitationVerification | null;
}
export interface RetrievalPolicy {
  id: string; version: string; defaults: RetrievalLimits; maxima: RetrievalLimits; maxQueryCharacters: number; maxSupportChecks: number;
  context: { schema: string; instructions: string; sourcesHeading: string; questionLabel: string };
}
export interface RetrievalPorts { provider: SearchProvider; extractor?: PassageExtractor | null; supportChecker?: SupportChecker | null }
export const RETRIEVAL_RECORD_SCHEMA: 'reploid.retrieval-record/v1';
export const RETRIEVAL_OUTCOMES: readonly RetrievalOutcome[];
export const CITATION_VERIFICATION_SCHEMA: 'reploid.citation-verification/v1';
export const SUPPORT_VERDICTS: readonly SupportVerdict[];
export function createRetrieval(options: RetrievalPorts & { policy?: RetrievalPolicy; now?: () => number }): {
  request(input: RetrievalRequestInput, content: string): RetrievalRequest;
  pending(request: RetrievalRequest, startedAt: number): RetrievalRecord;
  retrieve(record: RetrievalRecord, signal: AbortSignal | null): Promise<RetrievalRecord>;
  dispatch<T extends { messages: Array<{ role: string; content: string }> }>(request: T, record: RetrievalRecord): Promise<Omit<T, 'retrieval'>>;
  verify(answer: string, record: RetrievalRecord, signal: AbortSignal | null): Promise<CitationVerification>;
};
export function normalizeRetrievalLimits(requested?: Partial<RetrievalLimits>, policy?: RetrievalPolicy): RetrievalLimits;
export function normalizeRetrievalRequest(input: RetrievalRequestInput, content: string, policy?: RetrievalPolicy): RetrievalRequest;
export function retrieveSources(options: { record: RetrievalRecord; provider: SearchProvider; extractor?: PassageExtractor | null;
  signal?: AbortSignal | null; now?: () => number; policy?: RetrievalPolicy }): Promise<RetrievalRecord>;
export function renderSourceContext(sources: RetrievedSource[], policy?: RetrievalPolicy): string;
export function withSourceContext<T extends { messages: Array<{ role: string; content: string }> }>(request: T, record: RetrievalRecord,
  policy?: RetrievalPolicy): Promise<Omit<T, 'retrieval'>>;
export function retrievalFailureMessage(record: RetrievalRecord | null): string;
export function interruptRetrievalRecord(record: RetrievalRecord, finishedAt: number): RetrievalRecord;
export function parseCitations(answer: string): {
  claims: Array<Omit<CitationClaim, 'cited' | 'citations'>>;
  references: Array<{ start: number; end: number; markers: number[]; text: string }>;
  urls: Array<{ url: string; start: number }>;
};
export function verifyCitations(options: { answer: string; record: RetrievalRecord; checker?: SupportChecker | null;
  signal?: AbortSignal | null; maxSupportChecks?: number }): Promise<CitationVerification>;
export function createLexicalSupportChecker(options?: { supportedAt?: number; unsupportedBelow?: number }): SupportChecker & { qualified: false };
export function createFixedSearchProvider(options: { documents: Array<{ id: string; url: string; title: string; text: string }>;
  now?: () => number; id?: string; version?: string }): SearchProvider & PassageExtractor;
