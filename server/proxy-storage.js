import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sha256Hex } from './hashing.js';

/** Explicitly rooted VFS backups. */
export function mountProxyStorageRoutes(app, { rootDirectory, requireServerAccess }) {
const VFS_BACKUP_DIRECTORY = path.join(rootDirectory, 'vfs_backups');
const VFS_BACKUP_MAX_BYTES = Number(process.env.REPLOID_VFS_BACKUP_MAX_BYTES || 1024 * 1024);
const vfsBackupPathFor = (req) => {
  const subject = String(req.reploidAccessSubject || 'unknown');
  const namespace = sha256Hex(subject);
  return path.join(VFS_BACKUP_DIRECTORY, `${namespace}.json`);
};

const serializeVfsBackup = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('VFS backup must be a JSON object');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > VFS_BACKUP_MAX_BYTES) {
    throw new Error(`VFS backup exceeds ${VFS_BACKUP_MAX_BYTES} byte limit`);
  }
  return serialized;
};

// Endpoint to check for VFS state
app.get('/api/vfs/status', requireServerAccess, (req, res) => {
  try {
    const backupExists = fs.existsSync(vfsBackupPathFor(req));
    res.status(200).json({ backupExists });
  } catch (error) {
    console.error('Error checking VFS status:', error);
    res.status(500).json({ error: 'Failed to check VFS status.' });
  }
});

// Endpoint to save the VFS state
app.post('/api/vfs/backup', requireServerAccess, (req, res) => {
  try {
    const backupPath = vfsBackupPathFor(req);
    const serialized = serializeVfsBackup(req.body);
    fs.mkdirSync(VFS_BACKUP_DIRECTORY, { recursive: true, mode: 0o700 });
    const temporaryPath = `${backupPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, backupPath);
    res.status(200).json({ message: 'VFS state saved successfully.' });
  } catch (error) {
    console.error('Error saving VFS state:', error);
    res.status(500).json({ error: 'Failed to save VFS state.' });
  }
});

// Endpoint to load the VFS state
app.get('/api/vfs/restore', requireServerAccess, (req, res) => {
  try {
    const backupPath = vfsBackupPathFor(req);
    if (fs.existsSync(backupPath)) {
      const vfsState = fs.readFileSync(backupPath, 'utf8');
      res.status(200).json(JSON.parse(vfsState));
    } else {
      res.status(404).json({ error: 'No VFS backup found.' });
    }
  } catch (error) {
    console.error('Error loading VFS state:', error);
    res.status(500).json({ error: 'Failed to load VFS state.' });
  }
});
// --- End VFS Persistence Endpoints ---
}
