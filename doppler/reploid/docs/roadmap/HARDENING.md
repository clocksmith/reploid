# Phase 5: Hardening & Validation

External validation and optional hardening. Requires Phases 1-3 completion.

### External Validation

- [ ] **Security audit** — Commission third-party audit of sandbox boundaries: Web Worker isolation, VFS containment, network restrictions, evaluate escape vectors and document mitigations
- [ ] **Safety library** — Extract and publish core safety primitives (VFSSandbox, VerificationManager, HITLController) as standalone npm package with minimal dependencies
- [ ] **Academic paper** — Write paper on browser-native agent containment: threat model, architecture, empirical safety results, submit to ML safety venue (e.g., SafeAI workshop)
- [ ] **Compliance docs** — Create SOC2-style control documentation: access controls, audit logging, change management, incident response, for enterprise adoption
- [ ] **Cryptographic signing** — Implement module signing in VerificationManager: generate Ed25519 keypair on first boot, sign approved modules with `signModule(moduleCode)`, verify signatures on load with `verifyModule(moduleCode, signature)`, store public keys in genesis, reject unsigned modules in production mode

### Policy Engine (Optional)

- [ ] **Real policy enforcement** — Upgrade RuleEngine from stub to real enforcement: parse declarative policy DSL, compile to runtime checks, integrate with ToolRunner pre-execution hook
- [ ] **Declarative policies** — Define policy language supporting rules like `deny { tool.name == "fetch" && !tool.args.url.startsWith("https://api.internal/") }`, store policies in VFS `/policies/`
- [ ] **Violation detection** — Runtime policy checking with `PolicyEngine.check(tool, args)`, emit `policy:violation` events, configurable enforcement (warn vs block)

### Formal Verification (Optional)

- [ ] **Type-level guarantees** — Add TypeScript strict mode to all modules, define tool output schemas with Zod, runtime validation of tool returns against schemas
- [ ] **Proof-carrying code** — Prototype: attach invariant proofs to self-modifications, verify proofs before applying changes, start with simple invariants (e.g., "does not delete /core/")
- [ ] **Invariant checking** — Define system invariants in `/config/invariants.json`, check after each mutation batch, rollback on violation
