# Frozen diagnostic lexical grammar

This enumerator copies syntax, not facts by interpretation. It reads the existing `sourceMap` in stable order: original user questions and document passages, excluding all assistant messages. Changed text under an existing passage identity fails. Issued aliases `f000`, `f001`, ... bind source ID, exact start/end offsets, exact value, and an unchanged surrounding quote of at most 256 characters. All original messages/documents remain available; the compact model catalog contains only alias, lexical kind, source ID and value.

Supported spans, with left-to-right precedence:

1. Full English month plus day and optional four-digit year, preserving spelling. The existing calculator validates the calendar date and handles missing-year ambiguity during arithmetic.
2. `$` immediately followed by an unsigned integer or up-to-two-place decimal, with valid three-digit comma groups: money.
3. An unsigned number immediately followed by `%`: percent.
4. Standalone English zero through twelve or unsigned numbers. An immediately following `day(s)` or `week(s)` gives the corresponding duration kind; otherwise kind number. This does not assign meaning such as base price, limit, deposit or deadline.

Existing passage identifiers matching `D1:P1` through `D8:P...` are marked before scanning so their digits are not quantities. Word substrings such as `one` within `someone` are ignored. Every other digit, currency sign `$`, or percent sign must be consumed by a supported span; otherwise catalog construction fails visibly. Spans retain position and do not deduplicate equal values from different clauses. More than 40 facts fails under the existing calculator limit.

Unsupported forms fail rather than being repaired: signed amounts/numbers, other currency symbols or numeric currency codes, spaced currency/percent signs, scientific notation, numeric fractions/ranges, hyphenated number ranges, number words beyond twelve, partial decimal/comma groups, textual dollars/cents, and numeric business/working/calendar-day expressions or unsupported temporal units. `days or weeks` and `days/weeks` are rejected as ambiguous units. Impossible dates, truncated year forms, wrong kinds and out-of-range magnitudes also fail through the existing calculator. No zero is invented for an unknown amount.

Catalog entries do not establish inclusion, exclusion, truth, conditions, a semantic role, or whether a stated duration applies. In particular, original user claims can be incorrect; copying them does not elevate them above primary passages. Model operation choice and final factual/citation review retain responsibility for those distinctions.

The new tool input is exactly `operations`, with the unchanged supported operations and two alias operands each. Generated operations are never repaired. The adapter supplies the immutable freshly derived catalog to the existing `runCalculation`, and returns its results and scope; full source bindings remain in the experiment receipt. It does not calculate a particular case's expected answer or choose operations itself.
