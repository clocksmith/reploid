# Zero and X setup

Zero is the tabula-rasa, self-owning browser agent. Fresh Zero uses compact UI and
agent capsules; X retains its existing minimal profile and explicitly selected
upgrades. Both are separate from the ordinary [conversation flow](QUICK-START.md).

## Start

From a repository checkout, install dependencies with `npm install`, then run
`npm start` (Node.js 22+). Open `http://localhost:8000/zero` for the minimal base, or
`http://localhost:8000/x` for optional upgrades.

Use a modern browser with ES modules, IndexedDB and service workers, served on
localhost or HTTPS. Source ownership does not supply inference: configure a
reachable inference service separately.

## Choose inference

- **Fresh Zero** uses Connected agent on loopback and the managed Gemini endpoint on a
  public origin. Prerequisites and limits are in
  [compact Zero capsules](zero-capsules.md#providers-and-prerequisites) and the
  [connection contract](x/external-brain.md).
- **X and returning legacy instances** retain their provider setup interfaces,
  including proxy and local Doppler choices; see [Local models](#local-models-x-and-returning-instances).
  Credentials are not exported.

## Awaken Zero

Enter an objective and select **Awaken**. A fresh Zero, and X with no upgrades
selected, expose only `CreateTool`. For example:

> Create a tool called AddNumbers that takes two numbers and returns their sum.
> Include fixtures, activate it, then use it with 2 and 3.

CreateTool stages the source, checks declared fixtures, re-imports it for replay,
then activates a successful tool. Fresh Zero tools have scoped reads and artifact
writes; they cannot rewrite `/self` or `/zero` sources. Source/UI self-patching
remains a legacy-runtime capability, not an implied fresh-capsule permission.
Helpers are created when needed, not assumed to be installed. The base includes
validation and capability boundaries even though it has only one initial tool.

## Extend X

X defaults to **None: Zero core**. Its **Optional upgrades** selector adds
only the chosen source closure when the operator awakens it:

- `reflection`: file/promotion tools and verification infrastructure.
- `cognition`: memory and cognition tools.
- `substrate`: worker/runtime infrastructure.
- `full`: optimization and swarm tools.

These options add capabilities, not authority. Host shell/git dependencies remain
unavailable to lab tools; VFS writes and tool loading remain capability-scoped.
A model cannot approve its own candidate, change its evaluator or escalate grants.
Zero has no upgrade selector. X uses its own instance-scoped selection and does
not inherit old Zero settings or another instance's global upgrade preference.
X's technical baseline level remains `spark`; fresh Zero's capsule configuration
is separate from those genesis profiles. “Tabula rasa” describes its role, not the
older, incomplete `tabula` genesis preset.

## Runtime and persistence

The compact screen prioritizes conversation, prompt, current state and Stop.
Open **Inspect** for provider prerequisites and source export; X's retained runtime
also provides its existing metrics and trace controls. Errors and required approvals
remain visible, not hidden in inspection.

Ordinary reloads and build-version changes preserve browser VFS contents. Existing
instances are not automatically pruned or rewritten. An older instance may retain
its older source or installed tools; a reload is not a migration proof. Start a new
named instance (`/zero?instance=my-clean-zero` or `/x?instance=my-clean-x`) to use
the corrected roles without deleting prior work. Returning instances keep their
owned code, including the earlier inverted roles; this release does not migrate
them or transfer their upgrade settings. Do not use a reset to make an existing
workspace look minimal.

## Reproduce from source

Use **Export self-source** in Inspect. Fresh Zero exports `reploid.zero.image/v1`
([compact Zero contract](zero-capsules.md#source-only-reproduction)). X and returning legacy
instances retain their existing self-image format
([legacy/X self-source contract](x/self-source.md)). Older fieldless exports retain historical
routing; they are not silently relabelled.

## Local models (X and returning instances)

Fresh Zero does not bundle the provider picker or the Doppler runtime. The X boot wizard
offers two local paths.

### Proxy-local with Ollama

1. Start Ollama (`ollama serve`, default `http://localhost:11434`) and pull a model, for
   example `ollama pull qwen2.5-coder:7b`.
2. Optionally set `LOCAL_MODEL_ENDPOINT` in `.env` (the default is
   `http://localhost:11434`), plus any cloud keys for hybrid use (`GEMINI_API_KEY`,
   `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).
3. `npm start`, open `http://localhost:8000/x` and choose **Proxy**. The wizard probes the
   proxy and Ollama (`/api/tags` on port 11434). Choosing Ollama stores `hostType: proxy-local`
   and routes inference through the proxy.
4. Check the path with `curl http://localhost:8000/api/health`,
   `/api/proxy-status`, `/api/ollama/models` and `curl http://localhost:11434/api/tags`.

The proxy is Ollama-first. Other local servers work only if they expose Ollama-style
endpoints (`/api/tags`, `/api/chat`, `/api/generate`); generic OpenAI-compatible local
servers are not a supported path.

### Doppler in the browser

Needs a WebGPU browser and a reachable Doppler asset base (default `/doppler`). Choose
**Doppler** in the wizard, select the detected model, verify and awaken; the choice is stored
as `hostType: browser-local`, `provider: doppler`. Override the asset base with
`http://localhost:8000/x?dopplerBase=http://localhost:9000/doppler`.

### Troubleshooting

- Ollama not detected: `curl http://localhost:11434/api/tags`; start `ollama serve` and check
  `LOCAL_MODEL_ENDPOINT` and the port.
- Proxy up but no models: open `/api/health` and `/api/ollama/models`, then read the proxy log.
- Doppler option disabled: confirm WebGPU and the asset base, try `dopplerBase`, or use a clean
  browser profile if service-worker state looks stale.
- Storage pressure: Doppler assets and VFS state share browser storage; export artifacts
  before clearing site storage.

Local models do not bypass verification, HITL or arena gates; VFS mutation stays in the browser.
