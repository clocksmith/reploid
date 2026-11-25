import type { RouteAttemptBinding } from './partition.js';
export interface OrderedPartitionDisclosure {
  kind: 'coordinator-mediated-activations-and-tokens' | 'coordinator-mediated-activations-and-edge-tokens'; activationPaths: string[][];
  tokenRecipients: string[]; outputRecipients: string[];
}
/** `privacyBinding` narrows token context to the first and last stage when it binds the edges backend. */
export function orderedPartitionDisclosure(identity: RouteAttemptBinding, privacyBinding?: { route?: { backend?: string } } | null): OrderedPartitionDisclosure;
