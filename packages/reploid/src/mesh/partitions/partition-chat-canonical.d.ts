import type { PartitionPlan, PartitionLimits, PartitionBinding, PartitionRuntime } from './partition-runner.js';
import type { PartitionGrantAuthority } from './partition-grants.js';
import type { CanonicalParticipantDescription, CanonicalRunnerRuntime, CanonicalRunnerAttempt, CanonicalPublicationPort } from './partition-canonical-execution.js';
import type { EntryPublicationContext } from './partition-entry-publication.js';
export type CanonicalChatDescription = Pick<EntryPublicationContext,'coordinatorEpoch'|'routeId'|'stages'|'generation'|'vocabSize'>;
export function createCanonicalChatBinding(options:{runtime:PartitionRuntime & CanonicalRunnerRuntime;
 local:CanonicalParticipantDescription;remote:CanonicalParticipantDescription;authority:PartitionGrantAuthority;
 model:{id:string;identity:string};plan:PartitionPlan;planId:string;limits:PartitionLimits;coordinatorEpoch:string}):{
 describe():CanonicalChatDescription|null;
 check(context:EntryPublicationContext,binding:PartitionBinding,publication:CanonicalPublicationPort):EntryPublicationContext;
 attempt(input:{context:EntryPublicationContext;binding:PartitionBinding;publication:CanonicalPublicationPort;tokenIds:number[]}):CanonicalRunnerAttempt;
 readonly grantLimits:Pick<PartitionLimits,'maxTokens'|'maxPromptTokens'|'maxActivationBytes'|'maxOutputCharacters'>;
};
