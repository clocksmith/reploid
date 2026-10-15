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
/** Per-query usage a provider reports: billable requests and, when priced, the cost in micro-dollars (null when unpriced). */
export interface SearchUsage { provider: string; requests: number; costMicroUsd: number | null }
export type CostBearer = 'operator' | 'requester';
/** A search provider. The host owns its credentials, terms and any disclosure of the query to it. */
export interface SearchProvider {
  id: string; version: string;
  /** Names the search service a search-answer permission discloses the query to. */
  searchProvider?: string;
  /** Who pays this route's retrieval: the operator (a Reploid-paid provider) or the requester (their own device and tools). */
  costBearer?: CostBearer;
  /** `context.answer` is an opaque per-answer key a provider may record in its own usage log; it is not part of the query. */
  search(query: string, limits: RetrievalLimits, signal: AbortSignal, context?: { answer?: string }):
    Promise<SearchResult[] | { results: SearchResult[]; usage?: SearchUsage }>;
}
/** Where an extracted passage sits in the fetched document's extracted text, which `sha256` identifies. end - start is the passage length. */
export interface PassageDocument { url: string; contentType: string; characters: number; sha256: string; start: number; end: number; bytes?: number; status?: number }
export interface ExtractedPassage {
  sourceId: string; url?: string; text: string; retrievedAt: number; contentHash: string; document?: PassageDocument;
  /** This fetch's configured cost; null or absent when unpriced. */
  costMicroUsd?: number | null;
}
/** Fetches a source and extracts the passage text relevant to the query. */
export interface PassageExtractor {
  id: string; version: string;
  extract(input: { source: SearchResult; query: string; limits: RetrievalLimits; signal: AbortSignal; answer?: string }): Promise<ExtractedPassage>;
}
export type SupportVerdict = 'supported' | 'unsupported' | 'unverified';
/** A checker may report the check's cost; unreported costs are unknown. */
export interface SupportJudgment { verdict: SupportVerdict; reason: string; costMicroUsd?: number | null }
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
  /** The retained passage's offsets in the fetched document's extracted text, when the extractor reported them. */
  document?: PassageDocument;
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
  /** Support checks made and their summed reported cost (null when any check's cost is unknown). */
  usage?: { checks: number; costMicroUsd: number | null };
  claims: CitationClaim[];
  references: Array<{ start: number; end: number; markers: number[]; text: string; unresolved: number[] }>;
  unrecordedUrls: string[];
  flags: CitationFlag[];
  summary: { claims: number; citedClaims: number; uncitedClaims: number; citations: number; unresolvedCitations: number;
    supported: number; unsupported: number; unverified: number; unrecordedUrls: number };
  /** Claim-to-span mapping and deterministic validity; entailment awaits an independent reviewer. */
  claimSupport?: ClaimSupport;
}
export type CitationProblem = 'unresolved-marker' | 'mismatched-reference' | 'not-retrieved' | 'passage-hash-mismatch'
  | 'document-offsets-invalid' | 'context-digest-mismatch' | 'span-invalid';
export interface ClaimSpan { start: number; end: number; text: string; sha256: string; alignment?: 'sentence' | 'whole-passage' }
export interface ClaimCitation {
  marker: number; sourceId: string | null; url: string | null; passageHash?: string;
  document?: { sha256: string; start: number; end: number }; valid: boolean; problems: CitationProblem[]; span: ClaimSpan | null;
}
export interface MappedClaim {
  id: string; index: number; text: string; start: number; end: number; markers: number[]; citations: ClaimCitation[];
  /** True when at least one citation is deterministically valid, so a reviewer can decide it. */
  reviewable: boolean; verdict: SupportVerdict; reason: 'uncited' | 'unresolved-citation' | 'awaiting-review' | 'invalid-evidence';
}
export interface ClaimSupport {
  schema: 'reploid.claim-support/v1'; alignment: 'reploid.lexical-span-alignment/v1'; query: string | null; contextDigest: string | null;
  contextValid: boolean; claims: MappedClaim[];
  summary: { claims: number; citedClaims: number; reviewableClaims: number; citations: number; validCitations: number; invalidCitations: number;
    supported: number; unsupported: number; unverified: number };
}
export interface SupportReviewPacket {
  schema: 'reploid.claim-support-review-packet/v1'; id: string; instructions: string[]; question: string; answer: string;
  sources: Array<{ number: number; title: string; url: string; retrievedAt: number; passage: string; passageSha256: string }>;
  claims: Array<{ id: string; text: string; quote: { start: number; end: number };
    citations: Array<{ source: number; suggestedSpan: ClaimSpan }> }>;
}
export interface SupportReviewer { kind: 'human' | 'model'; id: string; model?: { provider: string; name: string; version?: string | null; identity?: string } }
/** A model's configured token prices; null when unpriced. */
export interface TokenPrice { inputMicroUsdPerMillionTokens: number; outputMicroUsdPerMillionTokens: number }
export interface SupportJudgments {
  schema: 'reploid.claim-support-judgments/v1'; packet: { id: string; sha256: string }; reviewer: SupportReviewer;
  judgments: Array<{ claim: string; verdict: SupportVerdict; basis: string;
    spans?: Array<{ source: number; start?: number; end?: number; quote?: string }> }>;
  /** Model reviews: reported tokens, configured price and cost (null when tokens or price are unknown). */
  usage?: { inputTokens: number | null; outputTokens: number | null; price: TokenPrice | null; costMicroUsd: number | null };
  /** Human reviews: a declared cost; absent means unpriced. */
  declaredCostMicroUsd?: number;
}
export interface GeneratorIdentity { modelId: string; modelIdentity: string }
export interface ClaimSupportResult {
  schema: 'reploid.claim-support-result/v1'; packet: { id: string; sha256: string }; reviewers: SupportReviewer[];
  claims: Array<{ id: string; text: string; start: number; end: number; citations: ClaimCitation[];
    evidence: Array<{ source: number; url: string | null; passageHash?: string; span: ClaimSpan | null; document?: { sha256: string; start: number; end: number } }>;
    verdict: SupportVerdict; reason: string; disputed: boolean;
    reviews: Array<{ reviewer: { kind: 'human' | 'model'; id: string }; verdict: SupportVerdict; basis: string; spans: Array<ClaimSpan & { source: number }> }> }>;
  summary: { claims: number; supported: number; unsupported: number; unverified: number; disputed: number; resolvedByThirdReview: number; awaitingReview: number; supportRate: number | null };
}
/** Entailment reviewer interface: a human queue returns null (judgments arrive later); a model reviewer returns judgments. */
export interface EntailmentReviewer {
  id: string; version: string; kind: 'human-queue' | 'model';
  review(packet: SupportReviewPacket, context: { generator: GeneratorIdentity; claimSupport?: ClaimSupport; signal?: AbortSignal | null }): Promise<SupportJudgments | null>;
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
  /** Provider-reported search usage and extraction volume, for quotes and service economics; null before a search returns. */
  usage?: { search: SearchUsage | null; extraction: { documents: number; bytes: number } } | null;
  verification: CitationVerification | null;
  /** Separate retrieval, verification and fallback costs for this answer; null while pending. Never part of conversation text. */
  costs?: RetrievalCosts | null;
}
/** Integer micro-USD amounts; null means unpriced or unmeasured, never free. Zero means the work did not happen. */
export interface RetrievalCostEntry {
  bearer: CostBearer | null;
  search: { service: string | null; requests: number | null; costMicroUsd: number | null };
  extraction: { attempted: number | null; documents: number | null; failed: number | null; bytes: number | null; costMicroUsd: number | null };
  costMicroUsd: number | null;
}
export type ReviewCost =
  | { kind: 'model'; packet: string | null; reviewer: string; inputTokens: number | null; outputTokens: number | null; price: TokenPrice | null; costMicroUsd: number | null }
  | { kind: 'human'; packet: string | null; reviewer: string; pricing: 'unpriced' | 'declared'; costMicroUsd: number | null };
export interface VerificationCostEntry {
  checker: { id: string; version: string; checks: number | null; costMicroUsd: number | null } | null;
  reviews: ReviewCost[];
  costMicroUsd: number | null;
}
export interface RetrievalCosts {
  schema: 'reploid.retrieval-costs/v1'; unit: 'micro-usd';
  retrieval: RetrievalCostEntry; verification: VerificationCostEntry;
  /** No fallback route exists yet: `{ path: 'none', costMicroUsd: 0 }`. */
  fallback: { path: string; costMicroUsd: number | null };
  totalMicroUsd: number | null;
  /** Components whose cost is unknown, for example 'retrieval.extraction'. */
  unknown: string[];
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
  retrieve(record: RetrievalRecord, signal: AbortSignal | null, options?: { answer?: string | null }): Promise<RetrievalRecord>;
  dispatch<T extends { messages: Array<{ role: string; content: string }> }>(request: T, record: RetrievalRecord): Promise<Omit<T, 'retrieval'>>;
  verify(answer: string, record: RetrievalRecord, signal: AbortSignal | null): Promise<CitationVerification>;
};
export function normalizeRetrievalLimits(requested?: Partial<RetrievalLimits>, policy?: RetrievalPolicy): RetrievalLimits;
export function normalizeRetrievalRequest(input: RetrievalRequestInput, content: string, policy?: RetrievalPolicy): RetrievalRequest;
export function retrieveSources(options: { record: RetrievalRecord; provider: SearchProvider; extractor?: PassageExtractor | null;
  signal?: AbortSignal | null; now?: () => number; policy?: RetrievalPolicy; answer?: string | null }): Promise<RetrievalRecord>;
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
export const CLAIM_SUPPORT_SCHEMA: 'reploid.claim-support/v1';
export const SPAN_ALIGNMENT: 'reploid.lexical-span-alignment/v1';
export const CITATION_PROBLEMS: readonly CitationProblem[];
export function mapClaimSpans(options: { answer: string; record: RetrievalRecord; policy?: RetrievalPolicy }): Promise<ClaimSupport>;
export function alignClaimSpan(claim: string, passage: string): { start: number; end: number; alignment: 'sentence' | 'whole-passage' };
export function passageSentences(passage: string): Array<{ start: number; end: number }>;
export function validSpan(passage: string, span: ClaimSpan | null | undefined): Promise<boolean>;
export const SUPPORT_REVIEW_PACKET_SCHEMA: 'reploid.claim-support-review-packet/v1';
export const SUPPORT_JUDGMENTS_SCHEMA: 'reploid.claim-support-judgments/v1';
export const SUPPORT_RESULT_SCHEMA: 'reploid.claim-support-result/v1';
export const REVIEW_VERDICTS: readonly SupportVerdict[];
export const SUPPORT_REVIEW_INSTRUCTIONS: readonly string[];
export function createSupportReviewPacket(options: { id: string; question: string; answer: string; record: RetrievalRecord; claimSupport: ClaimSupport }): SupportReviewPacket;
export function renderSupportReviewPacketMarkdown(packet: SupportReviewPacket): string;
export function validateGenerator(generator: unknown): GeneratorIdentity;
/** Throws when the reviewer is the generating model, by name or content identity. */
export function assertIndependentReviewer(reviewer: SupportReviewer, generator: GeneratorIdentity): void;
export function validateSupportJudgments(options: { packet: SupportReviewPacket; judgments: SupportJudgments; generator: GeneratorIdentity }):
  Promise<Map<string, { verdict: SupportVerdict; basis: string; spans: Array<ClaimSpan & { source: number }> }>>;
export function applySupportJudgments(options: { packet: SupportReviewPacket; claimSupport: ClaimSupport; judgments?: SupportJudgments[];
  generator: GeneratorIdentity }): Promise<ClaimSupportResult>;
export function supportPacketHash(packet: SupportReviewPacket): Promise<string>;
export function canonicalJson(value: unknown): string;
export const REVIEW_QUEUE_SCHEMA: 'reploid.claim-support-review-queue/v1';
export function createHumanReviewQueue(options?: { store?: { load(): unknown; save(state: unknown): void }; now?: () => number; requiredReviews?: number }):
  EntailmentReviewer & { kind: 'human-queue';
    pending(): Promise<Array<{ packet: SupportReviewPacket; sha256: string; reviews: number; thirdReviewClaims?: string[] }>>;
    packet(id: string): SupportReviewPacket;
    submit(judgments: SupportJudgments): Promise<{ packetId: string; reviews: number; requiredReviews: number; disagreements: string[]; needsThirdReview: boolean; complete: boolean }>;
    status(id: string): Promise<{ packetId: string; reviews: number; requiredReviews: number; disagreements: string[]; needsThirdReview: boolean; complete: boolean }>;
    result(id: string): Promise<ClaimSupportResult> };
export const MODEL_REVIEWER_SYSTEM: string;
export function renderModelReviewPrompt(packet: SupportReviewPacket): string;
export function createModelSupportReviewer(options: { identity: { provider: string; model: string; version?: string; identity?: string };
  strongerThan: string[];
  complete(input: { system: string; prompt: string; signal: AbortSignal | null }):
    Promise<string | { text: string; usage?: { inputTokens?: number | null; outputTokens?: number | null } }>;
  price?: TokenPrice | null; maxReplyCharacters?: number }):
  EntailmentReviewer & { kind: 'model'; reviewer: SupportReviewer };
export const RETRIEVAL_COSTS_SCHEMA: 'reploid.retrieval-costs/v1';
export const COST_BEARERS: readonly CostBearer[];
export const NO_FALLBACK: Readonly<{ path: 'none'; costMicroUsd: 0 }>;
/** The sum, or null when any amount is unknown. */
export function sumMicroUsd(values: Array<number | null>): number | null;
export function validTokenPrice(price: unknown): boolean;
export function tokenCostMicroUsd(input: { inputTokens: number | null; outputTokens: number | null; price: TokenPrice | null }): number | null;
export function reviewCostEntry(judgments: SupportJudgments): ReviewCost;
export function retrievalCostRecord(input: { retrieval: RetrievalCostEntry; verification?: VerificationCostEntry;
  fallback?: { path: string; costMicroUsd: number | null } }): RetrievalCosts;
/** Attaches a citation verification to its record and updates the verification cost entry. */
export function withVerification(record: RetrievalRecord, verification: CitationVerification): RetrievalRecord;
/** Adds entailment review costs from judgment files to the record's verification cost entry. */
export function withReviewCosts(record: RetrievalRecord, judgments: SupportJudgments[]): RetrievalRecord;
export function decodeEntities(text: string): string;
export function htmlFragmentText(fragment: string): string;
export function detectCharset(body: Uint8Array, contentType?: string, charset?: string | null): string;
/** Document text and title from HTML or plain-text bytes; the same bytes give the same text on every route. */
export function extractDocumentText(input: { body: Uint8Array | string; contentType?: string; charset?: string | null }):
  { text: string; title: string; characters: number };
/** An exact slice of `text` relevant to `query`, with its offsets. */
export function selectPassage(input: { text: string; query?: string; maxCharacters: number }): { text: string; start: number; end: number };
export function sha256Text(text: string): Promise<string>;
export const PAGE_FETCH_POLICY: { id: string; version: string; maxBytes: number; timeoutMs: number; maxRedirects: number;
  maxUrlCharacters: number; contentTypes: string[]; unsupportedContentTypes: string[] };
