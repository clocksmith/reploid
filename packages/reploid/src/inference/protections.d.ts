import type { Protection, ExecutionRouteValue } from '../chat/execution-policy.js';
import type { Disclosure, ReaderRole, Assumption } from './contract.js';
export interface DisplayRow { readonly label: string; readonly line: string }
/** The one source of the "Who can read it?" names and lines. Not ranked. */
export declare const PROTECTION_DISPLAY: Readonly<Record<Protection, DisplayRow>>;
/** "Where it runs": the route values. */
export declare const ROUTE_DISPLAY: Readonly<Record<ExecutionRouteValue, { readonly label: string }>>;
/** A participants choice, not a route. */
export declare const PARTICIPANTS_DISPLAY: Readonly<{ 'own-devices': DisplayRow }>;
/** Requester-held edges keep their own line; any other plaintext split shows splitReadersLine. */
export declare const SPLIT_DISPLAY: Readonly<{ 'requester-edges': { readonly line: string } }>;
export declare function splitReadersLine(count: number): string;
export declare const READER_ROLE_DISPLAY: Readonly<Record<ReaderRole, string>>;
export declare const ASSUMPTION_DISPLAY: Readonly<Record<Assumption, string>>;
export declare function describeDisclosure(disclosure: Disclosure): string;
export declare function promptReaderCount(disclosure: Disclosure): number | null;
export declare function protectionLabel(protection: string): string | null;
export declare const PROTECTION_GATE_REASONS: Readonly<Record<Exclude<Protection, 'plaintext'>, string>>;
export interface GatedRoute { route: ExecutionRouteValue; status: 'unavailable' | 'unknown'; reason: string; checked: ['host-configuration']; checkedAt: string }
export interface GatedCapability {
  protection: Protection; status: 'unavailable' | 'unknown'; reason: string; checked: ['host-configuration']; checkedAt: string; routes: GatedRoute[];
}
/** Capabilities from host configuration alone, for surfaces that resolve no route. Advisory, never permission to send. */
export declare function gatedCapabilities(options?: { enabled?: Protection[]; at?: number }): readonly GatedCapability[];
