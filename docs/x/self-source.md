# X self-source contract

X is the minimal base; Zero is its optional extension. This replaces the earlier
route inversion that called Zero minimal and X the fully loaded workbench.

## Source, capabilities and prerequisites

A minimal capability surface is not literally two source files. The initial prompt
and `CreateTool` need a complete bootstrap, agent loop, VFS, provider adapter,
validation/security support and usable browser UI. The source generator follows
static imports plus explicitly selected dynamic entry points and DI modules.

- `scripts/build-self-source.js` produces the exact per-level source catalog and
  default active manifest. Run it after changing an import or selected entry point;
  `node scripts/build-self-source.js --check` rejects a stale catalog.
- `self/config/boot-seed.js` seeds the exact selected closure and fails when a source
  dependency is missing. Neither X nor Zero hydrates the full repository in the
  background. Unselected tools, blueprints, UI and vendor packages are not seeded.
- Zero's explicit upgrade selection changes the selected source/tool inventory.
  The source catalog itself describes available levels; it is not their source code.
- Browser ES modules, IndexedDB and a same-origin static HTTP(S) host are explicit
  platform prerequisites. Inference is separately configured. Optional local model
  runtimes and weights require an explicit installation and are not hidden X code.

## Export and materialization

`exportSelfImage` reads the active source descriptor and emits only its declared
source with byte lengths and SHA-256 hashes. The UI explicitly includes installed
`/self/tools/*.js` because those are part of the current agent's executable source.
Unrelated user artifacts and state are not swept into the image.

The image regenerates its own exact VFS inventory, active source descriptor and
selected catalog profile. This is necessary so a fresh descendant seeds installed
tool sources rather than silently dropping them. Validation rejects incomplete
inventories, malformed paths, source size/hash mismatches and catalog divergence.

`materializeSelfImage` validates the image and emits a static host map, including
`/x`, the bootstrap and service-worker entry. It does not fetch the repository or
external runtime helpers. The exported exporter/materializer is itself in the
source closure, so materializing the next generation does not need repository code.

Source export is not a full workspace backup: inference credentials, browser
settings, conversation history and arbitrary user artifacts are deliberately not
included. Keep a separate workspace backup when those are needed.

## Authority and execution limits

A smaller graph cannot disable saved security or approval requirements. X/Zero
refuse tool import and execution if a configured PolicyEngine or HITL gate is
missing. Restore the required gate rather than silently falling back to autonomy.

Every ToolWriter/CreateTool creation requires a successful, non-skipped static
Verification Worker result, bound to the exact normalized code SHA-256 before
staging. Missing, failed, timed-out or mismatched verification refuses creation.
CreateTool checks the receipt again before importing and installing; both its
ToolRunner path and ToolWriter's optional SubstrateLoader path bind the hash at
the final bytes-to-import boundary. L0 tools use injected dependencies, not
unverified module imports. This required gate does not disable or replace saved
PolicyEngine/HITL requirements, and does not depend on the optional security toggle.

The lightweight VerificationManager is available in the base image but remains an
optional DI dependency: absence permits boot, not tool creation. The Worker starts
only when a verification is requested. The exported source includes the manager,
classic Worker, vendored Acorn parser and license. Lazy execution is not zero
source inventory: verification adds four declared files. With recorded playback,
the selected base contains 115 source files; the generated catalog is authoritative.
Worker/parser requests must resolve from the selected instance VFS, never a
missing-source network fallback.

CreateTool fixture replay checks behavior and declared dependency capabilities
scope injected APIs. Neither these checks nor Worker static analysis is a general JavaScript sandbox: tools can still
access browser globals. These checks must not be described as isolation from
untrusted JavaScript or a substitute for operator authorization.

## Publication-only Genesis baseline

Genesis locking gates publication of the minimal bootstrap, not individual tool
activation. The publisher quiesces source writers after all integration changes,
then uses `GenesisSnapshot.createPublicationBaseline` to capture every exact
source byte declared by the selected manifest. Missing or changing reads fail.
The content-addressed payload and immutable pin live under `/.genesis/publication`,
outside the executable closure, avoiding a self-referential source hash.

`getPublicationBaseline` and `exportPublicationBaseline` validate stored bytes
against the pin before reuse. `importPublicationBaseline` refuses replacement of
an existing pin. Ordinary snapshot import, deletion, pruning and restoration cannot
overwrite the publication payload or pin. `restorePublicationBaseline` validates
all hashes before the first write, restores each declared VFS path, checks the
written bytes and preserves unrelated user work. A partial write failure is an
explicit error, not a successful recovery; recovery is not a multi-file transaction.

The publisher retains the exact frozen payload outside mutable browser storage
and tests recovery against the final selected source. This is immutability through
the supported Genesis service APIs and the pinned artifact, not tamper-proof
storage against direct VFS, browser-global or hostile host access. Browser Web Locks
fence publication writers; other hosts must use a single publication writer.

GenesisSnapshot remains optional host/recovery tooling, not mandatory minimal-X
runtime machinery. A descendant that needs recovery must receive both the explicit
exported baseline payload and a compatible recovery implementation. The compact
shell does not claim that source export alone contains a workspace backup or a
Genesis recovery UI. No hidden repository fetch supplies missing recovery bytes.

## Preservation, not implicit migration

Build-version changes and ordinary warm starts do not clear the VFS. Existing
source and user-created work remain owned by the instance. No automatic source
migration, pruning or full-repository deletion is performed. A new named instance
is the clean-start path. A warm start of a new image does not prove migration of a
pre-change instance; those are separate cases.

## Acceptance evidence

Focused tests cover source import closure, minimal tool inventory, explicit Zero
upgrades, unchanged capability boundaries, missing-source rejection, preservation,
export integrity, installed-tool seeding and deterministic descendant re-export:

- [Minimal source tests](../../tests/unit/minimal-self-source.test.js)
- [Boot seed tests](../../tests/unit/boot-seed.test.js)
- [Required Worker gate tests](../../tests/unit/tool-verification-gate.test.js)
- [Publication Genesis tests](../../tests/integration/genesis-publication-baseline.test.js)
- [Export tests](../../tests/unit/self-image-export.test.js)
- [Browser reproduction scenario](../../tests/e2e/self-source-reproduction.spec.js)

The browser acceptance gate must use an export-only static map with no repository
fallback. It cold-boots X, creates and executes a tool through the real loop,
reloads without losing source/work, exports the actual browser descendant, and
boots that export on a distinct fresh origin. Missing-source requests and external
runtime fetches must be absent. Mocked unit tests alone are not browser evidence.

### Checkpoint limits (22 October 2026)

The earlier physical-browser check established L0 tool installation with real,
hash-bound Worker approval: a 115-source seed produced a 116-source descendant
that booted on a fresh origin. The final checkpoint adds failed-upgrade recovery
and repeat-click protection, verified by focused tests rather than a repeat of
that browser run. Its separately frozen 115-source publication baseline passed
exact restoration with unrelated saved work preserved in a local VFS harness.
That recovery check is not browser-import evidence. Fresh-file import remains
unverified through a physical-browser file picker. L1, L2 and L3 have not passed;
source publication does not qualify recursive improvement.
