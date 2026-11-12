import { spawn } from 'node:child_process';

/** One `gh api` call through the operator's existing GitHub CLI login; the token never enters this process. */
export function createGhApi({ command = 'gh', timeoutMs = 30000 } = {}) {
  return (method, route, body) => new Promise((resolve, reject) => {
    const args = ['api', '-X', method, '-H', 'Accept: application/vnd.github+json', route];
    if (body !== undefined) args.push('--input', '-');
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        try { resolve(out.trim() ? JSON.parse(out) : null); } catch (error) { reject(error); }
        return;
      }
      const status = Number(/HTTP (\d{3})/.exec(err)?.[1] ?? /"status":\s*"(\d{3})"/.exec(out)?.[1]) || null;
      const error = new Error(`gh api ${method} ${route.split('?')[0]} failed${status ? ` (HTTP ${status})` : ''}: ${err.trim().slice(0, 160)}`);
      error.status = status;
      error.rateLimited = status === 429 || (status === 403 && /rate limit/i.test(err + out));
      reject(error);
    });
    child.stdin.end(body === undefined ? '' : JSON.stringify(body));
  });
}

const dayOf = event => event.timestamp.slice(0, 10);
const encodedPath = file => file.split('/').map(encodeURIComponent).join('/');

/**
 * Append-only JSON Lines feed in a private repository: `events/YYYY-MM-DD.jsonl` plus `latest.json`,
 * written as one commit per batch through the Git data API. Lines already present are skipped,
 * so a batch whose commit landed but whose local delivery mark was lost is not duplicated.
 */
export function createGitHubFeed({ repository, branch = 'main', api }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Feed repository must be owner/name');
  const repo = `repos/${repository}`;
  const readFile = async (file, ref) => {
    let entry;
    try { entry = await api('GET', `${repo}/contents/${encodedPath(file)}?ref=${ref}`); }
    catch (error) { if (error.status === 404) return ''; throw error; }
    if (entry.encoding === 'base64' && entry.content) return Buffer.from(entry.content, 'base64').toString('utf8');
    const blob = await api('GET', `${repo}/git/blobs/${entry.sha}`);
    return Buffer.from(blob.content, 'base64').toString('utf8');
  };
  return Object.freeze({
    async publish(events) {
      if (!events.length) return { committed: null, appended: 0 };
      const head = (await api('GET', `${repo}/git/ref/heads/${branch}`)).object.sha;
      const base = (await api('GET', `${repo}/git/commits/${head}`)).tree.sha;
      const days = new Map();
      for (const event of events) days.set(dayOf(event), [...(days.get(dayOf(event)) || []), event]);
      const tree = [];
      let appended = 0;
      for (const [day, list] of days) {
        const file = `events/${day}.jsonl`, existing = await readFile(file, head);
        const present = new Set(existing.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line).event_id; } catch { return null; } }));
        const fresh = list.filter(event => !present.has(event.event_id));
        if (!fresh.length) continue;
        appended += fresh.length;
        const prefix = existing && !existing.endsWith('\n') ? existing + '\n' : existing;
        tree.push({ path: file, mode: '100644', type: 'blob', content: prefix + fresh.map(event => JSON.stringify(event)).join('\n') + '\n' });
      }
      if (!appended) return { committed: null, appended: 0 };
      const last = events.reduce((a, b) => (b.sequence > a.sequence ? b : a));
      const latest = { schema: 'reploid.fleet-feed-latest/v1', event_id: last.event_id, sequence: last.sequence,
        event_type: last.event_type, timestamp: last.timestamp, file: `events/${dayOf(last)}.jsonl`, notice: last.notice };
      tree.push({ path: 'latest.json', mode: '100644', type: 'blob', content: JSON.stringify(latest, null, 2) + '\n' });
      const created = await api('POST', `${repo}/git/trees`, { base_tree: base, tree });
      const first = events[0].sequence;
      const commit = await api('POST', `${repo}/git/commits`, {
        message: `Fleet feed: ${appended} event${appended === 1 ? '' : 's'} (sequence ${first}-${last.sequence})`,
        tree: created.sha, parents: [head] });
      // Fast-forward only; a concurrent writer makes this fail and the batch retries on the new head.
      await api('PATCH', `${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
      return { committed: commit.sha, appended };
    }
  });
}
