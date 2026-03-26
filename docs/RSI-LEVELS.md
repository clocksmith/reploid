# RSI Levels

This document explains the `L0` through `L4` ladder used by Reploid goal presets.

These levels are not guarantees about what the system can safely do in every session. They are a shorthand for how ambitious a goal is and how much self-modification it implies.

---

## Level Guide

| Level | Name | What it means |
|-------|------|---------------|
| `L0` | Basic Functions | Build ordinary tools, UI features, or workflows without changing the core substrate. |
| `L1` | Meta Tooling | Improve how the agent creates tools, organizes work, or evaluates results. |
| `L2` | Substrate | Modify runtime modules, coordination paths, or system plumbing that the agent itself depends on. |
| `L3` | Weak RSI | Run bounded self-improvement loops with evaluation, rollback, and explicit stopping conditions. |
| `L4` | Weak AGI | Use broad, hard prompts that test generalized autonomous planning, system-building, self-modeling, and self-directed experimentation. This is a frontier framing bucket, not a claim that full AGI already exists. |

---

## Practical Reading

- `L0` and `L1` are usually concrete product or tooling work.
- `L2` starts touching the agent's own runtime and needs much stronger controls.
- `L3` is where measured self-improvement experiments become real.
- `L4` is the frontier autonomy edge. It is useful as a framing device for hard, broad tasks, but it should not be confused with a claim that full AGI has been achieved.

---

## In Reploid

The preset goals in the boot wizard use this ladder to group tasks by ambition:

- `L0`: ordinary capability building
- `L1`: better meta-tooling
- `L2`: substrate mutation
- `L3`: bounded self-improvement loops
- `L4`: hard weak-AGI-style prompts for planning, modeling, and self-directed experimentation

For the runtime safety and governance interpretation of the same ladder, see [SECURITY.md](./SECURITY.md).

---

*Last updated: March 2026*
