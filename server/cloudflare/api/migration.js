/**
 * @fileoverview Operator-only migration routes: import documents exported from Firestore, and read
 * counts and documents back for parity checks (scripts/cloudflare/migrate-firestore.js). They exist
 * only while the MIGRATION_TOKEN Worker secret is set; without it every /admin path is a 404.
 */
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_DOCUMENTS = 2000;

function tokenMatches(header, secret) {
  const presented = new TextEncoder().encode(String(header || '').replace(/^Bearer\s+/i, ''));
  const expected = new TextEncoder().encode(String(secret || ''));
  if (!expected.length || presented.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= presented[index] ^ expected[index];
  return difference === 0;
}

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** In the Worker (no `firestore`): authenticate, then forward to the coordinator. In the coordinator: run. */
export async function handleMigration(request, env, firestore = null) {
  if (!env.MIGRATION_TOKEN) return json({ error: 'Not found' }, 404);
  if (!tokenMatches(request.headers.get('Authorization'), env.MIGRATION_TOKEN)) return json({ error: 'Unauthorized' }, 401);
  if (!firestore) return env.COORDINATOR.getByName('coordinator').fetch(request);
  const url = new URL(request.url);
  if (url.pathname === '/admin/inventory' && request.method === 'GET') return json({ collections: firestore.inventory() });
  if (url.pathname === '/admin/export' && request.method === 'GET') {
    const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') || 500)));
    return json({ documents: firestore.exportDocuments({ parent: url.searchParams.get('parent') || null, after: url.searchParams.get('after') || '', limit }) });
  }
  if (url.pathname === '/admin/import' && request.method === 'POST') {
    const text = await request.text();
    if (text.length > MAX_IMPORT_BYTES) return json({ error: 'Import batch too large' }, 413);
    let documents;
    try { ({ documents } = JSON.parse(text)); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!Array.isArray(documents) || documents.length > MAX_IMPORT_DOCUMENTS) return json({ error: 'documents must be an array of at most 2000' }, 400);
    try { return json({ imported: await firestore.importDocuments(documents) }); } catch (error) { return json({ error: error.message }, 400); }
  }
  return json({ error: 'Not found' }, 404);
}
