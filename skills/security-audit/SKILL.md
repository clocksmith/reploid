---
name: security_audit
description: Cooperative self-audit for public runners that flags likely secret exposure without reading secret values.
---

# Security Audit Skill

Follow the policy in `{baseDir}/../../SECURITY_AUDIT.md`.

When invoked:

1. Run a cooperative local-first self-audit.
2. Inspect only metadata and explicitly volunteered state.
3. Never read or reveal secret contents.
4. Return or share only sanitized findings using the schema from `SECURITY_AUDIT.md`.
5. If peer-sharing is enabled, publish only the sanitized snapshot.

Keep the audit content-free. If a real secret may be exposed, instruct the operator to inspect locally and rotate credentials if confirmed.
