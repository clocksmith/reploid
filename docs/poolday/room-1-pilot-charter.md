# Reploid Room-1 Pilot Charter: Prospective Protein Annotation Adjudication

## 1. Milestone Overview

**Milestone Name:** `Reploid Room-1: Prospective Protein Annotation Adjudication`  
**Purpose:** Test whether a proof-carrying Reploid Research Room reduces curator effort or improves adjudication quality on disputed public protein family and domain annotations compared to a frozen standard curator workflow.

---

## 2. Protocol Boundaries & Participant Roles

* **Target Public Catalog:** UniProtKB sequence annotations evaluated against InterPro and Pfam signature models.
* **Target User Role:** Professional protein biocurator / structural bioinformatics annotator.
* **Adjudication Decisions:** Exactly one of:
  - `retain`: Keep existing catalog family/domain boundary annotation.
  - `revise`: Update or narrow the annotation coordinates / family assignment based on evidence.
  - `reject`: Remove/invalidate false-positive family or domain assignment.
  - `unresolved`: Evidence remains insufficient or genuinely contradictory under current policy.
* **Baseline Arm:**
  - Standard curator toolset: UniProt entry review, InterProScan / Pfam search, BLAST / alignment tools, PubMed literature review, curator notebook/spreadsheet notes.
  - Active work timing, tool invocations, and sources consulted logged.
* **Reploid Arm:**
  - Identical evidence cutoff release date and resource budget.
  - Pinned `esm2-t12-35m-ur50d-f32-af32` model contract (sequence and residue-level embeddings).
  - Decision-memory retrieval of analogous prior room decisions.
  - Explicit contradiction logging and negative/failed evidence preservation.
  - Signed, attributable independent reviewer claims.
* **Independent Evaluator:**
  - Evaluator does not author case evidence.
  - Receives blinded case packages with arm identities masked until scoring.

---

## 3. The 24-Case Frozen Cohort

The pilot cohort consists of **24 public, family-disjoint protein sequences** with documented annotation ambiguities (e.g. conflicting domain boundaries, low-confidence automated HMM matches, fragmented domains, or conflicting family classifications).

Each case record in [`self/pool/adjudication-pilot-manifest.json`](../../self/pool/adjudication-pilot-manifest.json) binds:
1. `accession`: Public UniProtKB accession (e.g. `P0DTC2`, `Q9BYF1`).
2. `sequenceHash`: SHA-256 hash of the canonical amino-acid sequence.
3. `catalogAnnotation`: Existing catalog family/domain coordinates.
4. `disputeSummary`: Specific nature of the disagreement or boundary uncertainty.
5. `interProMatches`: Pinned InterPro/Pfam signature accessions.
6. `evidenceCutoff`: Version-pinned release timestamp.
7. `budgetLimitSeconds`: Frozen curator work budget per case.

---

## 4. Governing Metric & Success Criteria

* **Governing North-Star Metric:**
  `median_normalized_cost_to_predeclared_independently_replicated_conclusion_relative_to_baseline`
* **Success Paths (Predeclared Gate):**
  1. **Quality Path:** Higher proportion of independently replicated, non-contradicted decisions at equivalent curator active time ($p < 0.05$).
  2. **Effort Path:** $\ge 20\%$ reduction in median curator active time with non-inferior decision replication quality.
* **Operational Counters (Excluded from Product Success):**
  - Peer count, total inference calls, WebGPU receipts, and gossip messages are tracked as operational diagnostics only and cannot substitute for curator decision value.

---

## 5. Non-Claims & Strict Boundaries

* **No Biological Truth Claims:** Reploid does not claim to establish metaphysical biological truth or replace in vitro assays; it adjudicates *attributable decisions under a declared evidence policy*.
* **No Unbounded Compute Claims:** Inference is bounded by the pinned ESM-2 35M contract and local browser constraints.
* **Fail-Closed Reporting:** Incomplete cases, timeouts, or unverified claims are reported as incomplete and charged at maximum budget.
