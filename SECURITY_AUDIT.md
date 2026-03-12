# OpenClaw Security Audit

Cooperative self-audit for public runners, public servers, and public WebRTC listeners.

This document defines the policy that the `/audit` page implements. It is written for OpenClaw-style runners that can follow Markdown instructions or load a matching workspace skill.

## Purpose

Detect likely secret exposure without reading, extracting, storing, or transmitting secret contents.

The audit is defensive. It helps a runner inspect its own exposed surfaces and publish safe warnings to trusted peers in the same room.

## Consent

The runner or operator must opt in before any audit begins.

Minimum consent requirements:

- Explicit operator action such as checking a consent box or invoking a named audit skill
- Clear statement that the audit is cooperative and local-first
- Clear statement that secret values must not be read or transmitted

## Allowed Checks

The audit may inspect only metadata or explicitly volunteered state on the current origin.

Allowed inputs:

- URL path names and query parameter names
- LocalStorage key names
- SessionStorage key names
- IndexedDB database names
- DOM labels or UI state names that the local runner explicitly exposes to the audit page
- Manual attestations such as "private key panel open" or "seed phrase visible"
- Public route names such as `debug`, `dump`, `env`, `state`, `config`, or `export`

## Forbidden Actions

The audit must never do any of the following:

- Read secret values from storage
- Read private keys, seed phrases, mnemonics, passphrases, tokens, cookies, or clipboard contents
- Exfiltrate file contents, prompt contents, transcript contents, or hidden state
- Inspect unrelated tabs, desktop applications, or host files outside browser sandbox limits
- Fetch or replay wallet export files, keystores, or environment dumps
- Probe non-consenting runners

## Findings Schema

Each finding must be sanitized and content-free.

```json
{
  "severity": "critical",
  "code": "suspicious-storage-name",
  "summary": "localStorage contains a secret-like key name. Inspect the value locally without sharing it.",
  "surface": "localStorage",
  "subject": "wallet_private_key",
  "remediation": "Remove secret material from browser storage and rotate if exposure is confirmed."
}
```

Allowed severities:

- `critical`
- `warning`

## Snapshot Schema

Runners may share only sanitized audit snapshots.

```json
{
  "actor": {
    "alias": "runner-7b2f",
    "peerId": "audit-7b2fd930"
  },
  "generatedAt": "2026-03-12T17:00:00.000Z",
  "summary": {
    "total": 2,
    "critical": 1,
    "warning": 1
  },
  "findings": [
    {
      "severity": "critical",
      "code": "manual-seed-phrase-visible",
      "summary": "A seed phrase or recovery phrase is visible.",
      "surface": "manual-attestation",
      "subject": "seed_phrase_visible"
    }
  ]
}
```

## Room Protocol

Room participants may exchange only the following message categories:

- `hello`
- `chat-message`
- `audit-snapshot`

Message rules:

- Chat must never include secret values
- Snapshot payloads must follow the sanitized schema above
- Peers should treat all remote text as untrusted input and render it as plain text
- Rooms must be token-scoped and opt-in

## Response Policy

When findings exist:

1. Warn locally first.
2. Offer clear remediation steps.
3. Share only sanitized findings if the operator enabled peer sharing.
4. Encourage key rotation if actual exposure is confirmed by the operator.

## OpenClaw Runner Prompt

Use this block when instructing an OpenClaw runner to self-audit:

```md
Run a cooperative security self-audit.

Rules:
- Inspect only metadata and explicitly volunteered local state.
- Do not read or reveal any secret values.
- Do not open wallet exports, keystore blobs, or clipboard contents.
- Flag only sanitized findings with severity, code, surface, subject, and remediation.
- Warn locally first, then share only sanitized findings if peer sharing is enabled.

Check:
- URL path and query parameter names
- localStorage key names
- sessionStorage key names
- IndexedDB database names
- visible security-sensitive UI panels
- public debug or export routes
```

## Reference Implementation

The current browser implementation is available at `/audit`.

The matching OpenClaw workspace skill lives at `skills/security-audit/SKILL.md`.
