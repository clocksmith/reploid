import { hashDopplerEvidence, validateExecutablePack, executablePacksMatch } from './executable-pack.js';
import { sha256Hex, signCanonical, verifyCanonicalSignature } from './inference-receipt.js';
import { createCustodyContracts } from '../vendor/reploid/artifacts/custody/runtime.js';

// Host-owned policy and operation contracts; behavior lives in the package.
export const { createPeerPackSupplier, createPeerPackArtifactStore } = createCustodyContracts({ hashDopplerEvidence, validateExecutablePack, executablePacksMatch, sha256Hex, signCanonical, verifyCanonicalSignature });
