import { describe, expect, it } from 'vitest';
import {
  normalizeAuditSnapshot,
  runLocalSelfAudit,
  scanManualFlags,
  slugifyRoomId
} from '../../self/experimental/openclaw-audit/self-audit.js';

describe('OpenClaw audit helpers', () => {
  it('slugifies room names for room sharing', () => {
    expect(slugifyRoomId('  Public Audit Room  ')).toBe('public-audit-room');
    expect(slugifyRoomId('mesh///unsafe###name')).toBe('mesh-unsafe-name');
  });

  it('produces findings from metadata names without reading values', () => {
    const report = runLocalSelfAudit({
      locationHref: 'https://audit.example/audit?api_key=redacted',
      localStorageKeys: ['wallet_private_key', 'theme'],
      sessionStorageKeys: ['draft_token'],
      indexedDbNames: ['openclaw-seed-cache', 'harmless-cache'],
      manualFlags: {
        private_key_panel_open: false,
        seed_phrase_visible: false,
        env_dump_public: false,
        debug_snapshot_shared: false
      }
    });

    expect(report.summary.total).toBe(4);
    expect(report.summary.critical).toBe(2);
    expect(report.summary.warning).toBe(2);
    expect(report.findings.map((finding) => finding.subject)).toEqual([
      'api_key',
      'wallet_private_key',
      'draft_token',
      'openclaw-seed-cache'
    ]);
    expect(report.findings[0]).toHaveProperty('remediation');
  });

  it('turns manual attestations into safe findings', () => {
    const findings = scanManualFlags({
      private_key_panel_open: true,
      seed_phrase_visible: true,
      env_dump_public: false,
      debug_snapshot_shared: true
    });

    expect(findings).toHaveLength(3);
    expect(findings.every((finding) => finding.surface === 'manual-attestation')).toBe(true);
    expect(findings.filter((finding) => finding.severity === 'critical')).toHaveLength(2);
  });

  it('normalizes externally produced runner snapshots', () => {
    const snapshot = normalizeAuditSnapshot({
      actor: { alias: 'runner-a', peerId: 'peer-a' },
      findings: [
        {
          severity: 'critical',
          code: 'manual-seed-phrase-visible',
          summary: 'Seed visible',
          surface: 'manual-attestation',
          subject: 'seed_phrase_visible'
        }
      ]
    });

    expect(snapshot.actor.alias).toBe('runner-a');
    expect(snapshot.summary.total).toBe(1);
    expect(snapshot.findings[0].remediation).toBeTruthy();
  });

  it('recomputes snapshot summaries from sanitized findings', () => {
    const snapshot = normalizeAuditSnapshot({
      actor: { alias: 'runner-a', peerId: 'peer-a' },
      summary: { total: 0, critical: 0, warning: 0 },
      findings: [
        {
          severity: 'critical',
          code: 'manual-seed-phrase-visible',
          summary: 'Seed visible',
          surface: 'manual-attestation',
          subject: 'seed_phrase_visible'
        },
        {
          severity: 'warning',
          code: 'manual-debug-snapshot-shared',
          summary: 'Debug snapshot shared',
          surface: 'manual-attestation',
          subject: 'debug_snapshot_shared'
        }
      ]
    });

    expect(snapshot.summary).toEqual({
      total: 2,
      critical: 1,
      warning: 1
    });
  });
});
