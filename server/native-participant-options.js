export const participantOptions = Object.fromEntries(['model', 'model-directory', 'identity-file', 'rtc-module',
    'ws-module', 'gpu-module', 'adapter', 'execution-mode', 'partition-index', 'ordered-config', 'model-config', 'signaling-url', 'room', 'room-token', 'room-token-file', 'origin', 'cache-directory', 'supply-limit-gib',
    'rtc-config-file', 'owner-policy', 'shader-cache-root', 'earning-config', 'readiness-log', 'browser-search-profile', 'runtime-source-config'].map(key => [key, { type: 'string' }]).concat([
      ['supply-to', { type: 'string', multiple: true }], ['owner-pairing', { type: 'boolean', default: false }], ['web-search', { type: 'boolean', default: false }], ['help', { type: 'boolean', default: false }], ['canonical', { type: 'boolean', default: false }], ['share-files', { type: 'boolean', default: false }], ['contribute', { type: 'boolean', default: false }], ['connect-only', { type: 'boolean', default: false }]]));

export const participantHelp = `Reploid native participant (Node 22.13 or newer)
Usage: reploid-participant --connect-only|--share-files|--contribute
  --model <catalog id> --model-directory <read-only weights directory>
  --identity-file <private state/identity.json>
  --web-search (opt in to public Bing search and page extraction; no browser sign-ins)
  --browser-search-profile <dedicated absolute directory> (Google in owned Chrome; human checks stay manual)
  --rtc-module @roamhq/wrtc --ws-module ws [--gpu-module webgpu]
  [--rtc-config-file <absolute private JSON path>] (expiring TURN credentials; reread on negotiation and heartbeat)
  [--cache-directory <verified piece cache>] [--signaling-url <ws(s) URL>]
  [--room <namespace>] [--room-token-file <absolute path>] [--origin <allowed origin>]
  [--owner-pairing] (private whole-model host with desktop terminal approval)
  [--supply-limit-gib <GiB>] (lifetime file upload allowance for this cache; default 4)
  [--supply-to <peer:signing-identity>] (repeat to limit file grants to named computers)
  [--adapter <catalog adapter id>] (prepare this exact adapter with its base model)
  [--execution-mode partition|whole-model] (default: partition; never falls back;
     whole-model fills an incomplete --model-directory from verified peer pieces)
  [--partition-index 0|1] (explicit eligible stage for a two-stage route)
  [--ordered-config <absolute JSON path>] (explicit stage assignment and ordered limits)
  [--model-config <absolute JSON path>] (pinned operator model and partition request; private rooms only)
  [--runtime-source-config <absolute JSON path>] (hash-pinned local Doppler source and bounded gather;
     private unsigned partition compute only; no file sharing, peer acquisition, adapters or earning)
  [--canonical] (requires explicit catalog generation and a capable installed runtime)
  [--owner-policy <absolute JSON path>] (owner schedule, memory, rate, power, temperature and foreground limits)
  [--earning-config <absolute JSON path>] (reploid.native-earning/v1: earning service, sign-in and contribution offers; needs --owner-policy)
  [--shader-cache-root <absolute directory>] (sealed Mesa shader cache; default: shader-cache beside the identity file)
  [--readiness-log <absolute JSONL path>] (appends readiness spans and stage admissions for scripts/capacity-utilization.js; needs --contribute)

--room-token-file reads the private room token once at startup from a regular
file owned by this user with mode 0600; one trailing newline is removed.
--room-token <join marker> still works but exposes the token in process
arguments and prints a warning; it cannot be combined with --room-token-file.

File sharing and compute are separate explicit choices; both may be enabled.
Compute requires --gpu-module. Missing assigned pieces use authenticated peers.
SIGINT/SIGTERM stop admission, settle work and release owned resources.
On Linux, --contribute compiles GPU pipelines into a private Mesa shader cache that is
sealed only after a complete stage preparation and reused only for the same runtime,
provider, driver and program; MESA_SHADER_CACHE_DIR must not be set by the caller.
Native GPU uses Metal on macOS and Vulkan elsewhere. Model and route qualification
is separate from backend selection; --help opens no provider.`;
