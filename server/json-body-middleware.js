import express from 'express';

export function installJsonBodyMiddleware(app, { poolBackendOnly = false, poolJsonLimit } = {}) {
  // Research admits records up to 1,000,000 bytes, plus the JSON request envelope.
  // Parse that route before the smaller general Pool limit; its own validator
  // still enforces the record bound, signatures, model admission, and author.
  app.use('/pool/research/records', express.json({ limit: poolJsonLimit || '1mb' }));
  app.use(express.json({
    limit: poolBackendOnly ? (poolJsonLimit || '512kb') : '10mb',
    verify: (req, res, buffer) => {
      if (req.originalUrl?.startsWith('/change-control/github/webhooks')) {
        req.rawBody = Buffer.from(buffer);
      }
    }
  }));
}
