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

- **Fresh Zero on loopback** uses Connected agent when the bounded reasoning mailbox
  is enabled and a controller is present. The connected agent proposes model output;
  it does not gain shell access or execution authority. See the
  [connection contract](x/external-brain.md). A disabled host fails clearly; it does
  not silently switch to a paid provider.
- **Fresh Zero on a public origin** uses the existing managed Gemini endpoint with
  Firebase Auth and App Check. The host must supply valid access configuration and
  its deployed inference function. The checked-in App Check site key is unset;
  this source release does not create credentials or establish live inference.
- **X and returning legacy instances** retain their provider setup interfaces,
  including supported proxy/local Doppler choices. The fresh capsule seed does not
  preload Doppler, models or a general provider picker. Credentials are not exported.

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

Use **Export self-source** in Inspect. The JSON image contains declared source,
hashes and the installed tool sources selected by this action, not arbitrary
workspace artifacts, browser settings or credentials.

Fresh Zero uses the distinct `reploid.zero.image/v1` envelope and
`materializeZeroImage` in `self/zero/image.js`. X and returning legacy instances
retain their existing self-image format. Older fieldless exports retain historical
routing; they are not silently relabelled. Materialize the matching format and boot
its static host tree on a new origin with explicit browser/provider prerequisites.
A repository checkout is not a runtime prerequisite for the descendant. See the
[compact Zero contract](zero-capsules.md) and the
[legacy/X self-source contract](x/self-source.md).
