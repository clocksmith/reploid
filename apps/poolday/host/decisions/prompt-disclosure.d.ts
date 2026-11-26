/** Who can read the prompt: the case each set of facts names, and the wording each site states it with. */
export type DisclosureSite = 'composer' | 'sheet' | 'outcome' | 'invite' | 'protection' | 'preset' | 'route' | 'own-devices' | 'split-note' | 'alternative';
export type DisclosureCase = 'unavailable-mode' | 'local' | 'own-devices' | 'operator' | 'blocked' | 'blocked-pool' | 'named'
  | 'stages' | 'stages-edges' | 'could-read' | 'pool' | 'answering';
export type DisclosureFacts = {
  readonly computation?: string;
  readonly local?: boolean;
  /** The paired desktop that, with this device, is the only reader ("Only your devices"). */
  readonly desktop?: string | null;
  /** The one named computer whose operator can read the prompt. */
  readonly operator?: string | null;
  readonly blocked?: boolean;
  readonly named?: boolean;
  readonly stages?: boolean;
  readonly edges?: boolean;
  readonly stageCount?: number;
  readonly usable?: boolean;
  readonly pool?: boolean;
};
export const DISCLOSURE_SITES: ReadonlyArray<DisclosureSite>;
export const DISCLOSURE_WORDING: Readonly<Record<DisclosureCase, Partial<Record<DisclosureSite, string | ((facts: DisclosureFacts) => string)>>>>;
export function disclosureCase(facts?: DisclosureFacts): DisclosureCase;
export function promptDisclosure(facts: DisclosureFacts & { readonly site: DisclosureSite }): string;
