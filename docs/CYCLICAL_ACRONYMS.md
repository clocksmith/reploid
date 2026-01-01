## Project Concepts And Cyclical Acronyms

While seemingly a linguistic curiosity, the exploration of self-referential and mutually-referential acronyms offers a playful yet insightful parallel to core concepts of recursion and directed graphs. We treat these acronyms formally not as "category theory" in the algebraic sense, but as combinatorial predicates over strings.

---

### Formal Definitions

Let `Σ = {A..Z}` be the standard alphabet.

Let `A, B ∈ Σ^+` be non-empty strings (acronyms). Let `|A|` denote the length of string `A`.

Let `Expand(A) = (a_1, …, a_|A|)` be a sequence of word strings where the sequence length equals `|A|`.

**Assumptions**

- **Indexing**: All indexing is 1-based (`1 ≤ j ≤ |A|`).
- **Normalization**: All string equality checks are case-insensitive and written as `≡`.
- **Acronym Constraint**: For a valid expansion, the first letter of the `j`-th word must match the `j`-th letter of the acronym:
  - `First(a_j) ≡ A[j]`

---

### Category 1r: Recursive Acronyms

This category contains single acronyms defined by self-inclusion (for example GNU).

- **Axiom**: `∃ i ∈ [1, |A|] : a_i ≡ A`

This signifies a direct self-reference: the string `A` itself appears as one of the words within its own expansion sequence.

---

### Category 2t: Tail-Defined Mutual Pairs

This category describes a 2-cycle between two distinct acronyms `A` and `B` (`A ≢ B`). It is defined by two primary axioms regarding the "tail" (last word) of the expansions:

1. **Axiom 1**: `a_|A| ≡ B`
2. **Axiom 2**: `b_|B| ≡ A`

**Structural Consequences**

If the Acronym Constraint holds, Axioms 1 and 2 necessitate specific boundary symmetries without requiring extra axioms:

- Since `a_|A| ≡ B`, then `First(a_|A|) ≡ First(B)`.
- By the Acronym Constraint, `First(a_|A|) ≡ A[|A|]` (the last letter of `A`).
- **Corollary**: `First(B) ≡ Last(A)` (and symmetrically, `First(A) ≡ Last(B)`).

---

### Dynamics

Define the partial function:

- `f : Σ^+ ⇀ Σ^+`
- `f(x) ≡ LastWord(Expand(x))`

where `f(x)` is defined only when `Expand(x)` is a valid expansion satisfying the Acronym Constraint.

- **Category 1r** captures self-reference somewhere in the expansion. A special case is a tail self-reference, which yields a fixed point: `f(A) ≡ A`.
- **Category 2t** is a stable oscillation (2-cycle): `f(A) ≡ B` and `f(B) ≡ A`, with `A ≢ B`.

---

### Why Engage In This Game?

The patterns mirror systems where components are defined in terms of themselves or each other. Constructing acronym pairs that satisfy strict interlocking axioms resembles searching constrained spaces, similar to evolutionary search. Definitions that loop (`A` includes `B`, `B` includes `A`) also parallel closed systems and, conceptually, self-modifying code.

*Last updated: December 2025*

