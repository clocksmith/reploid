#!/usr/bin/env node
/** Native participant API and installed command. Imports never open providers. */
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { main } from './native-participant-cli.js';
export { main };
export { createChatCompletions } from './chat-completions.js';
export { createResponses } from './responses.js';
export { createMessages } from './messages.js';
export { summarizeNativePartitionState } from './native-participant-state.js';
export { normalizeNativeDataChannel, createNativeRtcAdapter } from './native-rtc-adapter.js';
export { openNativeModelSource } from './native-model-source.js';
export { createNativeGpuHost } from './native-gpu-host.js';
export { openNativePartition } from './native-partition.js';
export { createNativeParticipant } from './native-participant-runtime.js';
export { createNativeShutdown } from './native-shutdown.js';
export { readNativeRoomTokenFile, resolveNativeRoomToken } from './native-room-token.js';

// npm starts a package command through a symbolic link, so real paths are compared:
// a plain path comparison made the installed command exit without doing anything.
const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  await main();
}
