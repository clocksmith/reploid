const SECRET_NAME_PATTERN = /(private[-_ ]?key|seed|mnemonic|passphrase|keystore|wallet|api[-_ ]?key|token|secret|auth|credential|session)/i;
const CRITICAL_NAME_PATTERN = /(private[-_ ]?key|seed|mnemonic|passphrase|keystore|wallet)/i;
const SENSITIVE_ROUTE_PATTERN = /(debug|dump|export|env|state|config|session)/i;

const MANUAL_FLAG_DEFS = {
  private_key_panel_open: {
    severity: 'critical',
    code: 'manual-private-key-panel',
    summary: 'A private-key surface is visible to the operator or agent.'
  },
  seed_phrase_visible: {
    severity: 'critical',
    code: 'manual-seed-phrase-visible',
    summary: 'A seed phrase or recovery phrase is visible.'
  },
  env_dump_public: {
    severity: 'critical',
    code: 'manual-env-dump-public',
    summary: 'A debug or environment dump appears to be publicly reachable.'
  },
  debug_snapshot_shared: {
    severity: 'warning',
    code: 'manual-debug-snapshot-shared',
    summary: 'Debug snapshots or transcripts may expose sensitive metadata.'
  }
};

export function slugifyRoomId(input = '') {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function classifyNameRisk(name = '') {
  if (!name) return 'warning';
  return CRITICAL_NAME_PATTERN.test(name) ? 'critical' : 'warning';
}

export function createFinding({ severity = 'warning', code, summary, surface, subject }) {
  return {
    id: `${code}:${surface}:${subject}`,
    severity,
    code,
    summary,
    surface,
    subject,
    remediation: getRemediation(code)
  };
}

export function getRemediation(code = '') {
  switch (code) {
    case 'suspicious-storage-name':
      return 'Remove secret material from browser storage and rotate credentials if exposure is confirmed.';
    case 'suspicious-indexeddb-name':
      return 'Verify no secret material is cached in IndexedDB, then clear the database and rotate if needed.';
    case 'suspicious-query-parameter':
      return 'Remove secret-like parameters from the URL and invalidate any credentials that may have been shared.';
    case 'insecure-transport':
      return 'Move the runner to HTTPS before sharing findings or operating on public networks.';
    case 'sensitive-route-name':
      return 'Review the route locally and ensure no debug or export payload is publicly exposed.';
    case 'manual-private-key-panel':
    case 'manual-seed-phrase-visible':
      return 'Close the sensitive panel immediately and rotate credentials if any unauthorized view may have occurred.';
    case 'manual-env-dump-public':
      return 'Disable the public dump route, remove exposed material, and rotate any leaked credentials.';
    case 'manual-debug-snapshot-shared':
      return 'Scrub debug snapshots before sharing and remove any previously published sensitive metadata.';
    default:
      return 'Inspect locally and rotate credentials if exposure is confirmed.';
  }
}

export function scanStorageNames(names = [], surface) {
  return names
    .filter((name) => SECRET_NAME_PATTERN.test(name))
    .map((name) =>
      createFinding({
        severity: classifyNameRisk(name),
        code: 'suspicious-storage-name',
        summary: `${surface} contains a secret-like key name. Inspect the value locally without sharing it.`,
        surface,
        subject: name
      })
    );
}

export function scanDatabaseNames(names = []) {
  return names
    .filter((name) => SECRET_NAME_PATTERN.test(name))
    .map((name) =>
      createFinding({
        severity: classifyNameRisk(name),
        code: 'suspicious-indexeddb-name',
        summary: 'IndexedDB includes a secret-like database name. Verify no secret material is cached.',
        surface: 'indexeddb',
        subject: name
      })
    );
}

export function scanUrlMetadata(locationHref = '') {
  if (!locationHref) return [];

  const findings = [];
  const url = new URL(locationHref);

  if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    findings.push(
      createFinding({
        severity: 'warning',
        code: 'insecure-transport',
        summary: 'This page is using HTTP outside localhost. Findings and warnings should travel over HTTPS.',
        surface: 'location.protocol',
        subject: url.protocol
      })
    );
  }

  for (const [key] of url.searchParams.entries()) {
    if (!SECRET_NAME_PATTERN.test(key)) continue;
    findings.push(
      createFinding({
        severity: classifyNameRisk(key),
        code: 'suspicious-query-parameter',
        summary: 'The URL contains a secret-like parameter name. Remove the parameter and re-audit locally.',
        surface: 'location.search',
        subject: key
      })
    );
  }

  const pathSegments = url.pathname.split('/').filter(Boolean);
  for (const segment of pathSegments) {
    if (!SENSITIVE_ROUTE_PATTERN.test(segment)) continue;
    findings.push(
      createFinding({
        severity: 'warning',
        code: 'sensitive-route-name',
        summary: 'The current path includes a debug-like route name. Verify the route does not expose secrets.',
        surface: 'location.pathname',
        subject: segment
      })
    );
  }

  return findings;
}

export function scanManualFlags(flags = {}) {
  return Object.entries(MANUAL_FLAG_DEFS)
    .filter(([flag]) => Boolean(flags[flag]))
    .map(([flag, def]) =>
      createFinding({
        severity: def.severity,
        code: def.code,
        summary: def.summary,
        surface: 'manual-attestation',
        subject: flag
      })
    );
}

export function summarizeFindings(findings = []) {
  return findings.reduce(
    (summary, finding) => {
      summary.total += 1;
      summary[finding.severity] += 1;
      return summary;
    },
    { total: 0, critical: 0, warning: 0 }
  );
}

export async function collectBrowserAuditInputs(win = window) {
  const getKeys = (storage) => {
    try {
      return Object.keys(storage || {});
    } catch {
      return [];
    }
  };

  let indexedDbNames = [];
  if (win.indexedDB?.databases) {
    try {
      const databases = await win.indexedDB.databases();
      indexedDbNames = databases
        .map((db) => db?.name)
        .filter(Boolean);
    } catch {
      indexedDbNames = [];
    }
  }

  return {
    locationHref: win.location?.href || '',
    localStorageKeys: getKeys(win.localStorage),
    sessionStorageKeys: getKeys(win.sessionStorage),
    indexedDbNames
  };
}

export function runLocalSelfAudit(inputs = {}) {
  const findings = [
    ...scanUrlMetadata(inputs.locationHref),
    ...scanStorageNames(inputs.localStorageKeys, 'localStorage'),
    ...scanStorageNames(inputs.sessionStorageKeys, 'sessionStorage'),
    ...scanDatabaseNames(inputs.indexedDbNames),
    ...scanManualFlags(inputs.manualFlags)
  ];

  const deduped = Array.from(new Map(findings.map((finding) => [finding.id, finding])).values());
  return {
    findings: deduped,
    summary: summarizeFindings(deduped)
  };
}

export function buildAuditSnapshot(report, actor) {
  return {
    actor,
    generatedAt: new Date().toISOString(),
    summary: report.summary,
    findings: report.findings.map(({ severity, code, summary, surface, subject, remediation }) => ({
      severity,
      code,
      summary,
      surface,
      subject,
      remediation
    }))
  };
}

export function normalizeAuditSnapshot(snapshot, fallbackActor = {}) {
  const actor = {
    alias: String(snapshot?.actor?.alias || fallbackActor.alias || 'runner').slice(0, 48),
    peerId: String(snapshot?.actor?.peerId || fallbackActor.peerId || 'external').slice(0, 48)
  };

  const findings = Array.isArray(snapshot?.findings)
    ? snapshot.findings.slice(0, 20).map((finding) => ({
        severity: finding?.severity === 'critical' ? 'critical' : 'warning',
        code: String(finding?.code || 'external-finding').slice(0, 64),
        summary: String(finding?.summary || 'Sanitized runner finding.').slice(0, 220),
        surface: String(finding?.surface || 'runner-self-audit').slice(0, 80),
        subject: String(finding?.subject || 'unspecified').slice(0, 80),
        remediation: String(
          finding?.remediation || getRemediation(finding?.code || '')
        ).slice(0, 220)
      }))
    : [];

  const summary = snapshot?.summary && typeof snapshot.summary === 'object'
    ? {
        total: Number(snapshot.summary.total) || findings.length,
        critical: Number(snapshot.summary.critical) || findings.filter((finding) => finding.severity === 'critical').length,
        warning: Number(snapshot.summary.warning) || findings.filter((finding) => finding.severity === 'warning').length
      }
    : summarizeFindings(findings);

  return {
    actor,
    generatedAt: String(snapshot?.generatedAt || new Date().toISOString()).slice(0, 48),
    summary,
    findings
  };
}
