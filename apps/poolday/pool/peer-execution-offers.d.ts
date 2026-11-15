import type { OperationCandidateAssessment, OperationProviderCandidate } from '../../../shared/vendor/reploid/contracts/pool/peer-planning.js';
import type { WorkRequirements } from '../../../shared/vendor/reploid/contracts/pool/peer-capabilities.js';
export declare function assessExecutionOffers(rows: OperationCandidateAssessment[], providers: Map<string, OperationProviderCandidate>, requirements: WorkRequirements): Promise<OperationCandidateAssessment[]>;
