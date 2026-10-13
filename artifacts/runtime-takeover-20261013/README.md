# Runtime takeover investigation

Component: Reploid partition discovery/admission and Doppler GPU pipeline preparation
Intent: preserved
Boundary effects: none; read-only investigation, no runtime adoption or GPU reservation

## Current public boundary

`public-discovery.json` is a fresh GPU-disabled requester observation of the
unchanged public bundle. Four computers project ready Qwen offers. This does not
reproduce the earlier missing-offer observation and does not prove inference.
The snapshot projection in `self/ui/pool-home/network-controls.js` obtains
`phase` and model offer from available `network.partitionPeers` descriptions;
connected transport peers alone cannot supply that ready phase.

Suby's existing native log, observed at 2026-10-13T18:27:01Z, reports
`partition-state`, `phase: ready`, `offering: true`, no error, the Qwen 0.8B model,
and a two-participant placement. This is the last logged contributor state,
separate from fresh requester discovery. No prompt was sent or recipient grant
created. Signed acquisition and actual streamed replies remain separate tests.

## Live ownership observation

Read-only SSH checks on the established AMD and Suby endpoints succeeded.
Suby public native PID 297260 and browser-controller PID 299769 remain;
failed provider 879623 and supervisor 879612 are absent. Another Suby Node
process is the existing `server/proxy.js`, not a new numerical campaign.
AMD and Suby both contain other agent sessions and browser/Node processes;
the Mac also has an existing Chrome session. None was stopped or adopted.
No physical reservation was acquired. Process absence still does not establish
normal GPU settlement of the failed run. Endpoint addresses remain outside Git.

The observed Suby host has roughly 26 GiB available RAM and nearly full swap;
the AMD host also has full swap. These are transient observations, not budgets.
Suby's user cgroup exposes the memory controller, but delegation and effective
limits for a new transient unit remain to be verified before any compiler run.

## Compilation boundary

`compilation-boundary.json` compares original immutable receipts. The recurrent
shader and native Dawn binary are identical between the passing AMD operator
control and failing Suby control. WGSL module diagnostics completed without
errors; `createComputePipelineAsync` for the recurrent entry point did not
complete. No numerical case ran. The kernel OOM receipt proves process RAM
exhaustion, not GPU-buffer-budget exhaustion.

The prior AMD recurrent compile alone took 204.784 seconds. Suby's preceding
phases consumed about 140 seconds of its unchanged 300-second total operation
budget, leaving about 160 seconds for recurrence and numerical work. These are
different hosts and preceding workloads, so this is not a speed comparison or
proof of the cause. The timeout and later OOM remain separate outcomes.

The recurrent shader still combines Q/K normalization, sequential paired state
updates, output RMS normalization, and paired SiLU. Its reachable helper chain
includes nested compensated arithmetic and polynomial evaluation. Compiler
expansion is a hypothesis; no internal compiler profile proves it yet. The
control retains previously prepared pipelines in an array. Existing receipts
lack per-phase RSS, so accumulated retained memory is another unresolved cause.

## Next bounded diagnostic, not launched

1. Obtain a fresh machine/controller reservation, listing public co-tenants and
   preserving unknown allocations. Start with a compiler-only control, not a
   model load or inference request.
2. Freeze the exact original recurrent WGSL, entry point `main`, default
   workgroup override, native provider hash, driver, adapter, and compiler/cache
   settings. Keep shared caches intact and record their condition. Copy no
   new runtime into public contributors.
3. Put the provider and descendants in a dedicated systemd user service with
   `MemoryHigh=6G`, `MemoryMax=8G`, `MemorySwapMax=0`, `MemoryOOMGroup=yes`,
   `OOMPolicy=kill`, `KillMode=control-group`, `RuntimeMaxSec=300`, and
   `TimeoutStopSec=10`. These are proposed diagnostic host-RAM limits, not the
   GPU allocation cap. Read back cgroup limits before loading the provider;
   if enforcement is unavailable, do not launch. The observer stays outside
   the constrained cgroup. A bound hit is a retained diagnostic failure.
4. First compile only recurrence in a fresh process. Observe shader-module
   validation and pipeline creation separately. Capture phase timestamps,
   process RSS/high-water mark, cgroup memory.current/peak/events, exit status,
   and host/device close outcome. Do not allocate model tensors or dispatch.
5. Only if that control settles within bounds, compare gate-only preparation,
   then gates followed by recurrence under the same limits and identities.
   Stop after a limit/timeout; do not repeat unchanged or raise bounds silently.
   Isolated success plus accumulated failure implicates retained preparation;
   isolated failure localizes the compiler path more narrowly.
6. If recurrence itself is the problem, profile/minimize compilation in the
   provider/compiler boundary. Any later split of normalization/state/output
   work must retain both components, exact operation order and reductions,
   sequential token dependencies, buffer lifetimes, the approved reference,
   `0.001`, and the existing GPU ceiling. Qualify that change independently;
   no arithmetic substitution is authorized by this diagnosis.

Then freeze one ordinary archive including the signed ordered facade fixes and
run the existing signed selective-acquisition, all-prefix placement, streamed
answer/follow-up and concurrent lifecycle gates. Keep ordinary N-stage capacity
and canonical publication under existing owners; fork/replay remains separate.
No acceptance boxes close from this investigation. Public Doppler stays 0.6.27.
