import type { RouteAttemptBinding } from './partition.js';
export interface OrderedPartitionDisclosure {
  kind: 'coordinator-mediated-activations-and-tokens'; activationPaths: string[][];
  tokenRecipients: string[]; outputRecipients: string[];
}
export function orderedPartitionDisclosure(identity: RouteAttemptBinding): OrderedPartitionDisclosure;
