import type { AuxiliaryDetail, AuxiliaryPath } from '../chat/execution-policy.js';
export declare const SEARCH_DISCLOSURE_PROTOCOL: 'reploid.search-disclosure/v1';
export declare const BRAVE_SEARCH_ORIGIN: 'https://api.search.brave.com';
export declare function disclosureOrigin(value: string): string;
export declare function serverSearchPath(detail: AuxiliaryDetail, origins: {serverOrigin: string; searchOrigin: string}): AuxiliaryPath;
