# Independent whole-answer review packet, Launch 1 model

Date: 2026-10-14. State: frozen and sealed; no review has been made yet.

This folder is a blinded packet for independent whole-answer review of Reploid's Launch 1 model. The Reploid product specification (section 4, consumer utility) and requirement REP-8 call for frozen evaluation rules per task type and for independent review of whole answers, including false additions. Earlier grades of these answers were made by the author of the item set, so they are not independent. This packet is how independent grades get made.

It has two uses:
- **Human reviewers**, chosen by the user.
- **An interim review by a different reviewer model**, run later from these files alone.

It records no grades, sets no threshold and makes no release decision.

---

## Files

| File | Content |
|---|---|
| `evaluation-policies.md` | The frozen evaluation rules: policy Q (everyday questions and explanations), policy S (summaries and rewrites of supplied text), and policy R (search-backed answers, frozen but pending REP-8). It defines element grades, answer statuses, the evidence each element records, and how code is run. |
| `packet.json` | The blinded packet, machine version. Authoritative for exact answer text. |
| `packet.md` | The same packet for human reading, with the policy each item uses and blank working tables. |
| `grading-template.json` | The structure a reviewer fills in: reviewer identity, independence and method; a per-item reference; per answer, the elements with grade, basis, evidence and executions, and the status. |
| `README.md` | This file. |

## Frozen hashes

| Object | sha256 |
|---|---|
| `evaluation-policies.md` (reploid-whole-answer-policies 1.0.0) | `41550353a495f6268ae1a0dffdaf9619af1d0ae0edaab7c3b0241414b19abacb` |
| `packet.json` | `aeac982ebff3734408ed590a89df8fa886e251eb96f00b3cfeb99c34a7487d48` |
| `packet.md` | `0d71fb56e3c8e2b0aef6a5c2f6d433c2e43a7ed4f30e27c149543f32c0feacfb` |
| `grading-template.json` | `14cc748f8226d4f075413877ef71d39a416014c5cbdd6c9100f60cae6c9ab7ba` |
| Sealed key (not in this repository) | `44c3df3abce280236afceca3bd63ebb13447bbe16e4ec7e04e21b866e8abc5ac` |

The policy hash freezes the rules. Any change to them makes a new version with a new hash, and grades always name the version they used.

**The sealed key** maps each neutral item id and side to the original item and the model variant. It is kept outside the repository and will be revealed after all reviews are complete. At reveal, check its sha256 against the value above before using it.

## What the packet contains

| | Items | Answers |
|---|---|---|
| Policy Q | 35 | 82 |
| Policy S | 5 | 10 |
| Policy R | 0 | 0 |
| **Total** | **40** (34 one-turn, 6 two-turn) | **92** (46 per side) |

Each item has:
- a neutral id, `R01` to `R40`;
- the policy that applies;
- the prompt;
- **Answer A** and **Answer B**: two variants of the same model answering the same prompt.

For a two-turn item, each side has two answers. Turn 1 is graded on its own. Turn 2 is shown with its context: the turn-1 prompt and that side's own turn-1 answer, as the application built the history.

Answer ids have the form `R05-A-t2` (item, side, turn). Each answer is the exact delivered text with its sha256. Every answer ended on the model's own end-of-turn marker; none was cut off by a length limit. The model had no system message, no tools and no retrieval.

**Excluded:**
- anything that identifies the variant: variant names, timings, token counts and token data, file paths, generation order;
- reference answers, mechanical checks and earlier grades. Reviewers establish correctness themselves.

## How human reviewers use it

1. Read `evaluation-policies.md` in full.
2. Work only from this folder. Do not open the sealed key, earlier grades of these answers, or any other file in the Reploid repository or its history. Earlier artifacts show these same answers with their variant labels.
3. Copy `grading-template.json` to a file of your own and fill in the reviewer block first: your name or role, your independence declaration and your method.
4. For each item, record the reference before reading either answer: each asked part with its correct answer and evidence, and for policy S the required-content list.
5. Grade Answer A and Answer B separately, never against each other. For each answer:
   - enumerate every element;
   - give each element a grade (correct, incorrect or unverified), a basis and its evidence;
   - record each code run as the policy's section 5 requires: outside any repository, with the command, program, inputs, stdout, stderr and exit status;
   - derive the status. Only whole-answer correct passes; incorrect and unverified never count as passing.
6. `packet.md` has blank tables for working notes. Final grades go in your copy of the template.
7. Return the file to the user. Do not share grades with other reviewers until every review is complete.

## Interim model review

- **Model.** Use a model other than the one that wrote the item set, these policies and this packet (Claude Opus 5.5, `claude-opus-5-5`).
- **Inputs.** Give it only this folder's files. Give it no repository checkout and no access to the sealed key.
- **Code execution.** It needs a sandbox with Python 3 and Node.
- **Identity.** The grading file records the model name, exact version, provider and run date.
- **Labeling.** Its grades are an interim model review, reported separately and not counted as human review.

## Blinding method

- **Ordering and sides.** One seeded pseudorandom generator shuffled the item order, then assigned the variant shown as Answer A independently for each item. The seed, the exact procedure and the mapping are in the sealed key, not here.
- **Neutral ids.** Item ids `R01` to `R40` follow the shuffled order and carry no link to the original item ids.
- **Same variant within a side.** Both turns of a side in a two-turn item come from one variant, because turn 2 was generated from that side's own turn 1.
- **Field audit.** Before freezing, a text search of the packet files confirmed that no variant names, generation timings, token data, file paths or host names appear in them.

Limits of the blind:
- **The blind is procedural.** These answer texts, with their variant labels and earlier grades, exist elsewhere in the repository. The blind holds only if reviewers do not consult them.
- **One prompt appears twice.** One turn-1 prompt appears in two items: once as a one-turn item, and once as turn 1 of a two-turn item. Each variant's answer to it was generated once and appears in both items. A reviewer can see which sides of those two items share a variant, but not which variant it is. Grade both occurrences.
- **Identical pairs.** In 5 answer pairs, A and B are identical text.

## What is not covered

- **Search-backed answers.** Policy R is frozen but pending REP-8. Reploid has no retrieval yet, so the packet has no search answers.
- **Single-author item set.** One author wrote all 40 items: Claude Opus 5.5, which also wrote these policies and this packet. Independent grading does not make the items independent or representative. They are short prompts written for testing, not drawn from real conversations.
- **English only.**
- **One generation per variant.** Each answer is one greedy generation, with no sampling variation.
- **Not the deployed GPU route.** The answers come from a CPU reproduction of the application's text path, not from the deployed browser GPU route.
- **No decision.** Pass floors, allowed gaps between variants, and how to use the results are the user's decision.

Component: Reploid Launch 1 answer-quality evidence for REP-8 (artifact only). Intent: preserved. Acceptance evidence: this folder's files and hashes; no review exists yet. Boundary effects: none. No existing artifact, application or Doppler file was modified.

*Last updated: October 2026*
