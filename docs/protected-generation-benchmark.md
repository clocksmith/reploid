# Single-peer protected generation benchmark

The Node benchmark runs a pinned support-ticket task through the normal float64
model, Doppler's HE-friendly plaintext circuit, and the same circuit on one
WebGPU peer. It uses the signed Reploid protected route and the Doppler Node
key-holder bridge. Both repositories need their normal dependencies installed.
Use a Doppler checkout that contains `tools/privacy-protected/triage-task.js`
and a machine with a working Node WebGPU adapter.

```sh
node scripts/protected-generation-benchmark.js --doppler ../doppler --report /tmp/ckks-triage.json
```

The full command evaluates 64 held-out tickets. Use `--cases 2` for a diagnostic
run that exercises cold key upload and warm key reuse. A diagnostic subset
cannot establish full-task performance. The command checks plaintext quality
before opening a GPU and emits JSON even when a gate fails.

The report includes the pinned task, model, circuit, and parameter digests,
answer quality, shared-prefix and free-running diagnostics, CKKS logit
error, elapsed time to the first token, and each decode interval. Timings
include the requester's encryption and decryption calls and time from final
decryption to emission. Cold key scheduling includes generating, forwarding
and acknowledging the keys. It is reported separately from warm results.
Byte counts include the real lane and one trap lane. The signed frame totals
include framing and exclude TCP/IP overhead. Peak RSS is reported separately
for the requester, key holder and WebGPU evaluator. GPU buffer peaks reflect
allocations tracked by Doppler. The benchmark uses synthetic tickets on a
loopback connection and includes those tickets and their answers in its report.

Each session explicitly requests homomorphic execution and names the evaluator
identity. The provider loads compiled constants before it starts listening.
The requester holds the secret key and supplies encrypted token representations.
The provider holds the weights and encrypted state. Decode sends one fresh
encrypted token per lane and keeps the earlier state on the evaluator. The
requester receives encrypted logits, decrypts locally, and selects the next
token with argmax.

This tooling enables the research route only in the benchmark process. The
production route is disabled pending review. Known-answer traps and signed
receipts establish different properties from a security review. The benchmark
exercises one peer and measures its numerical and resource margins before a
separate split-route experiment.
