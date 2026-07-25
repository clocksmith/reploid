# Blueprint 0x000120: pool firebase auth

**Objective:** Describe implementation for pool/firebase-auth.js.

**Target Upgrade:** pool/firebase-auth.js

**Affected Artifacts:** /pool/firebase-auth.js

---

### 1. Intent
Bootstrap Firebase Auth only when a hosted Pool page has an explicit config or
can obtain Firebase Hosting's generated config.

### 2. Architecture
Explicit Reploid config wins. Non-loopback hosted pages may then probe
`/__/firebase/init.json` and lazily import the Firebase app and auth modules.
Loopback development remains unauthenticated unless config is injected.

### 3. Implementation Notes
Do not probe Firebase Hosting's generated endpoint on localhost, `127.0.0.1`,
or `::1`; the regular Reploid development server does not expose it and the
404 is not an auth signal. Firebase emulator use remains available by injecting
`REPLOID_FIREBASE_CONFIG` or `REPLOID_POOL_FIREBASE_CONFIG`.

### 4. Verification Checklist
- [x] Loopback bootstrap does not issue the hosted-config request
- [x] Explicit config remains available on loopback
- [x] Hosted pages may probe Firebase Hosting config

*Last updated: July 2026*
