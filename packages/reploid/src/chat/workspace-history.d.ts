import type { ChatThread } from './index.js';
import type { TransactionalChatStore, createConversationPublication } from './workspace-publication.js';
import type { CanonicalPublicationPort } from '../mesh/partitions/partition-canonical-execution.js';
import type { EntryPublicationRecord } from '../mesh/partitions/partition-entry-publication.js';
import type { OrderedPublicationPort } from '../mesh/partitions/partition-ordered-publication.js';
export interface PersistedWorkspace {
 schema:'reploid.chat-workspace/v1';meshId:string;participantId:string;selectedId?:string|null;threads:ChatThread[];
}
export interface CanonicalWorkspaceHistory {
 readonly supportsWholeModel:boolean;readonly mode:'transactional';readonly writerEpoch:string;readonly legacyDrafts:string|null;readonly drafts:string|null;
 saveDrafts(raw:string):Promise<unknown>;
 load():PersistedWorkspace;save(input:PersistedWorkspace):Promise<unknown>;
 assertCurrentWriter():Promise<void>;
 /** One writer per conversation; it admits canonical two-stage and ordinary ordered attempts. */
 publication(threadId:string):Promise<CanonicalPublicationPort & OrderedPublicationPort>;
 project(threadId:string,attemptId:string,record:EntryPublicationRecord):Promise<{
 threadId:string;attemptId:string;content:string;publicationDigests:string[];terminal:boolean}>;
 close():Promise<void>;
}
export function openCanonicalWorkspaceHistory(options:{store:TransactionalChatStore;key:string;meshId:string;participantId:string;
 writerEpoch:string;expectedWriterEpoch:string|null;legacy:{workspace:string|null;drafts:string|null};
 maxWorkspaceBytes:number;maxThreads:number;allowWholeModel?:boolean;
 publicationOptions(threadId:string):Omit<Parameters<typeof createConversationPublication>[0], 'conversationId'|'writerEpoch'|'store'|'requireCommitEvidence'>;
}):Promise<CanonicalWorkspaceHistory>;
