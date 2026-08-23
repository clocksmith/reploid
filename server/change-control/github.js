/**
 * @fileoverview GitHub App authentication, webhook verification, and required checks.
 */

import crypto from 'crypto';
import nodeFetch from 'node-fetch';

const base64Url = (value) => Buffer.from(value)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

const jsonBase64Url = (value) => base64Url(JSON.stringify(value));

export function buildGitHubAppJwt({ appId, privateKey, now = Date.now() } = {}) {
  if (!appId || !privateKey) throw new Error('GitHub App ID and private key are required');
  const issuedAt = Math.floor(now / 1000) - 30;
  const header = jsonBase64Url({ alg: 'RS256', typ: 'JWT' });
  const payload = jsonBase64Url({ iat: issuedAt, exp: issuedAt + 540, iss: String(appId) });
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey);
  return `${unsigned}.${base64Url(signature)}`;
}

export function verifyGitHubWebhookSignature({ secret, rawBody, signature }) {
  if (!secret || !signature || !Buffer.isBuffer(rawBody)) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const responseJson = async (response) => {
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = { raw }; }
  if (!response.ok) {
    const error = new Error(`GitHub API ${response.status}: ${body?.message || raw || response.statusText}`);
    error.statusCode = response.status;
    error.body = body;
    throw error;
  }
  return body;
};

export function createGitHubAppClient({
  appId,
  privateKey,
  apiBase = 'https://api.github.com',
  fetchImpl = nodeFetch,
  now = () => Date.now()
} = {}) {
  const installationTokens = new Map();
  const headers = (token) => ({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'reploid-change-passport'
  });

  const installationToken = async (installationId) => {
    const cached = installationTokens.get(String(installationId));
    if (cached && Date.parse(cached.expiresAt) - now() > 60000) return cached.token;
    const jwt = buildGitHubAppJwt({ appId, privateKey, now: now() });
    const response = await fetchImpl(`${apiBase}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: headers(jwt)
    });
    const body = await responseJson(response);
    installationTokens.set(String(installationId), body);
    return body.token;
  };

  const upsertCheck = async ({
    installationId,
    owner,
    repo,
    headSha,
    passportId,
    status,
    conclusion = null,
    title,
    summary,
    detailsUrl = null
  }) => {
    const token = await installationToken(installationId);
    const checkHeaders = headers(token);
    const listResponse = await fetchImpl(
      `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(headSha)}/check-runs?check_name=${encodeURIComponent('Reploid Change Passport')}`,
      { headers: checkHeaders }
    );
    const list = await responseJson(listResponse);
    const existing = (list.check_runs || []).find((entry) => entry.external_id === passportId);
    const payload = {
      name: 'Reploid Change Passport',
      head_sha: headSha,
      external_id: passportId,
      status,
      output: { title, summary },
      ...(detailsUrl ? { details_url: detailsUrl } : {}),
      ...(conclusion ? { conclusion } : {})
    };
    const endpoint = existing
      ? `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/check-runs/${existing.id}`
      : `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/check-runs`;
    const response = await fetchImpl(endpoint, {
      method: existing ? 'PATCH' : 'POST',
      headers: { ...checkHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return responseJson(response);
  };

  const requestForInstallation = async (installationId, endpoint, init = {}) => {
    const token = await installationToken(installationId);
    const response = await fetchImpl(`${apiBase}${endpoint}`, {
      ...init,
      headers: {
        ...headers(token),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {})
      }
    });
    return responseJson(response);
  };

  const createDeployment = async ({
    installationId,
    owner,
    repo,
    ref,
    environment,
    passportId,
    description,
    idempotencyKey
  }) => {
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/deployments`;
    const existing = await requestForInstallation(
      installationId,
      `${endpoint}?ref=${encodeURIComponent(ref)}&environment=${encodeURIComponent(environment)}&per_page=100`
    );
    const matching = (Array.isArray(existing) ? existing : []).find((deployment) => (
      deployment.payload?.schema === 'change.passport-github-deployment/v1'
      && deployment.payload?.passportId === passportId
      && deployment.payload?.idempotencyKey === idempotencyKey
    ));
    if (matching) return matching;
    return requestForInstallation(installationId, endpoint, {
      method: 'POST',
      body: JSON.stringify({
        ref,
        environment,
        description,
        auto_merge: false,
        required_contexts: [],
        payload: {
          schema: 'change.passport-github-deployment/v1',
          passportId,
          idempotencyKey
        }
      })
    });
  };

  const createRollbackPullRequest = async ({
    installationId,
    owner,
    repo,
    baseBranch,
    rollbackRevision,
    passportId,
    rollbackId,
    reason
  }) => {
    const safeSuffix = `${passportId}-${rollbackId}`.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100);
    const branch = `reploid/rollback-${safeSuffix}`;
    const repositoryEndpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const openPullsEndpoint = `${repositoryEndpoint}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(baseBranch)}`;
    const existing = await requestForInstallation(installationId, openPullsEndpoint);
    if (Array.isArray(existing) && existing.length) return existing[0];

    let branchExists = false;
    try {
      await requestForInstallation(installationId, `${repositoryEndpoint}/git/ref/heads/${encodeURIComponent(branch)}`);
      branchExists = true;
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
    if (!branchExists) {
      const baseRef = await requestForInstallation(
        installationId,
        `${repositoryEndpoint}/git/ref/heads/${encodeURIComponent(baseBranch)}`
      );
      const rollbackCommit = await requestForInstallation(
        installationId,
        `${repositoryEndpoint}/git/commits/${encodeURIComponent(rollbackRevision)}`
      );
      const restoreCommit = await requestForInstallation(
        installationId,
        `${repositoryEndpoint}/git/commits`,
        {
          method: 'POST',
          body: JSON.stringify({
            message: `Restore ${passportId} to ${rollbackRevision}`,
            tree: rollbackCommit.tree.sha,
            parents: [baseRef.object.sha]
          })
        }
      );
      try {
        await requestForInstallation(
          installationId,
          `${repositoryEndpoint}/git/refs`,
          {
            method: 'POST',
            body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: restoreCommit.sha })
          }
        );
      } catch (error) {
        if (error.statusCode !== 422) throw error;
      }
    }
    return requestForInstallation(
      installationId,
      `${repositoryEndpoint}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: `Rollback ${passportId}`,
          head: branch,
          base: baseBranch,
          body: `${reason}\n\nChange Passport: ${passportId}\nRollback request: ${rollbackId}`
        })
      }
    );
  };

  return { createDeployment, createRollbackPullRequest, installationToken, upsertCheck };
}

export function toGitHubCheckProjection(projection = {}, gate = {}) {
  if (projection.decision?.state === 'revoked') {
    return { status: 'completed', conclusion: 'failure', title: 'Decision revoked', summary: 'The Change Passport decision is revoked.' };
  }
  if (projection.decision?.state === 'reopened') {
    return { status: 'completed', conclusion: 'failure', title: 'Decision reopened', summary: 'A declared trigger reopened the active decision.' };
  }
  if (projection.decision?.state === 'rejected') {
    return { status: 'completed', conclusion: 'failure', title: 'Change rejected', summary: projection.decision.current?.rationale || 'The change was rejected.' };
  }
  if (projection.decision?.state === 'unresolved') {
    return { status: 'completed', conclusion: 'neutral', title: 'Decision unresolved', summary: projection.decision.current?.rationale || 'The decision remains unresolved.' };
  }
  if (projection.decision?.state === 'approved' && gate.eligible) {
    return { status: 'completed', conclusion: 'success', title: 'Change eligible', summary: 'Frozen evidence and approval satisfy the Change Passport policy.' };
  }
  return {
    status: 'in_progress',
    conclusion: null,
    title: 'Change blocked',
    summary: gate.reasons?.length ? gate.reasons.join('\n') : 'Change Passport evidence and approval are incomplete.'
  };
}

export default {
  buildGitHubAppJwt,
  createGitHubAppClient,
  toGitHubCheckProjection,
  verifyGitHubWebhookSignature
};
