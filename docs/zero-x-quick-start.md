# Zero and X setup

Zero is the tabula-rasa, self-owning browser agent. X starts from the same minimal
base and may add explicitly selected upgrades. Both are separate from the ordinary [conversation flow](QUICK-START.md).

## Start

From a repository checkout, install dependencies with `npm install`, then run
`npm start` (Node.js 22+). Open `http://localhost:8000/zero` for the minimal base, or
`http://localhost:8000/x` for optional upgrades.

Use a modern browser with ES modules, IndexedDB and service workers, served on
localhost or HTTPS. Source ownership does not supply inference: configure a
reachable inference service separately.

## Choose inference

- **Server proxy** uses the managed proxy configured in the boot form. Test the
  endpoint before awakening. Server credentials are not part of a source export.
- **Connected agent** is available on local X when the bounded loopback reasoning
  mailbox is enabled. The connected agent proposes model output; it does not gain
  shell access or execution authority. See the [connection contract](x/external-brain.md).
- **Optional local Doppler** is a Zero-only choice. It installs its selected adapter
  source and requires a separately available Doppler runtime, model assets and
  WebGPU. The minimal base does not preload that runtime or its models.

## Awaken Zero

Enter an objective, choose the cycle interval and select **Awaken**. A fresh Zero,
and X with no upgrades selected, expose only `CreateTool`. For example:

> Create a tool called AddNumbers that takes two numbers and returns their sum.
> Include fixtures, activate it, then use it with 2 and 3.

CreateTool stages the source, checks declared fixtures, re-imports it for replay,
then activates a successful tool. Reading, writing and self-mutation helpers are
created when needed, not assumed to be installed. The base includes validation,
capability boundaries and runtime source even though it has only one initial tool.

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
The technical baseline level remains `spark`; “tabula rasa” describes Zero's role,
not the older, incomplete `tabula` genesis preset.

## Runtime and persistence

The compact screen prioritizes conversation, prompt, current state and Stop.
Open **Inspect** for metrics, raw trace and source export. Errors and required
approvals must remain visible, not hidden in inspection.

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

New exports bind the chosen Zero/X surface in the hashed source descriptor.
Older fieldless exports retain their historical routing; they are not silently
relabelled. The exported materializer emits a static host tree. Boot that tree on a new origin
with the same explicit browser/hosting prerequisites and configure inference anew.
A repository checkout is not a runtime prerequisite for the descendant. See the
[self-source contract and acceptance checks](x/self-source.md).
