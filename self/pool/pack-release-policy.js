import { openPackReleaseCheckpoints } from '../infrastructure/pack-release-storage.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { snapshotPackOperationData } from './pack-operation.js';

const requireValue = (value, message) => { if (!value) throw new Error(`Pack release policy: ${message}`); };

/** The application retains anti-rollback state; Doppler retains verification authority. */
export async function prepareLocalPackRelease({ model, now = Date.now, openCheckpoints = openPackReleaseCheckpoints }) {
  const options = model.packOpenOptions;
  if (model.executablePack.schema !== 'doppler.pack/v3') return { options, assertCurrent() {}, close() {} };
  const authority = options.releaseEvents?.[0]?.signature?.authority;
  const applicationId = model.application?.applicationId;
  requireValue(typeof authority === 'string' && authority.length > 0 && typeof applicationId === 'string'
    && applicationId.length > 0, 'explicit release authority and application required');
  requireValue(Number.isSafeInteger(options.releasePolicy?.minimumSequence)
    && options.releasePolicy.minimumSequence > 0, 'explicit minimum release sequence required');
  const namespace = await hashDopplerEvidence({ authority, applicationId });
  const storage = await openCheckpoints();
  try {
    let checkpoint = await storage.read(namespace);
    const minimumSequence = Math.max(checkpoint.sequence, options.releasePolicy.minimumSequence);
    const checkTime = session => {
      const lifecycle = session.verification?.lifecycle;
      requireValue(lifecycle && lifecycle.event.sequence >= minimumSequence, 'verified lifecycle required');
      requireValue(Date.parse(lifecycle.event.issuedAtUtc) <= now(), 'release issuance is in the future');
      requireValue(Date.parse(lifecycle.event.expiresAtUtc) > now(), 'release eligibility expired');
      return lifecycle;
    };
    return {
      options: { ...options, releasePolicy: { ...options.releasePolicy, minimumSequence,
        now: new Date(now()).toISOString(), checkpoint: snapshotPackOperationData(checkpoint) },
      async persistReleaseCheckpoint(next) { checkpoint = await storage.advance(namespace, checkpoint, next); } },
      checkTime,
      async assertCurrent(session) {
        const lifecycle = checkTime(session);
        const saved = await storage.read(namespace);
        requireValue(lifecycle.checkpoint.sequence === saved.sequence && lifecycle.checkpoint.digest === saved.digest,
          'release checkpoint changed; reopen with current signed history');
      },
      close: () => storage.close()
    };
  } catch (error) { storage.close(); throw error; }
}
