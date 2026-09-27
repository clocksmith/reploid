import { DurableObject } from 'cloudflare:workers';
import bootstrap from '../../self/config/swarm-bootstrap.json';
import policy from './policy.json';

// Coordinates bounded admission leases, not signaling traffic or conversation state.
export class SwarmAdmission extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, room TEXT NOT NULL, expires INTEGER NOT NULL, joined INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS windows (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
  }

  prune() {
    this.ctx.storage.sql.exec('DELETE FROM leases WHERE expires <= ?', Date.now());
    this.ctx.storage.sql.exec('DELETE FROM windows WHERE expires <= ?', Date.now());
  }

  consume(id, maximum, duration) {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec('SELECT count FROM windows WHERE id = ?', id).toArray();
    if ((rows[0]?.count || 0) >= maximum) return false;
    sql.exec('INSERT INTO windows VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count=count+1', id, Date.now() + duration);
    return true;
  }

  async reserve(room) {
    this.prune();
    const sql = this.ctx.storage.sql, limits = bootstrap.server;
    if (!this.consume('connect', limits.maxConnectionsPerWindow, limits.connectionWindowMs)) return null;
    const rows = sql.exec('SELECT room, COUNT(*) AS count FROM leases GROUP BY room').toArray();
    if (rows.reduce((sum, row) => sum + row.count, 0) >= limits.maxConnections) return null;
    if (!rows.some(row => row.room === room) && rows.length >= limits.maxRooms) return null;
    const id = crypto.randomUUID();
    sql.exec('INSERT INTO leases VALUES (?, ?, ?, 0)', id, room, Date.now() + policy.leaseMs);
    await this.arm();
    return id;
  }

  activate(id) {
    this.prune();
    const sql = this.ctx.storage.sql;
    const lease = sql.exec('SELECT joined FROM leases WHERE id = ?', id).toArray()[0];
    if (!lease) return false;
    if (!lease.joined && sql.exec('SELECT COUNT(*) AS count FROM leases WHERE joined = 1').one().count >= bootstrap.server.maxPeersTotal) return false;
    sql.exec('UPDATE leases SET joined = 1, expires = ? WHERE id = ?', Date.now() + policy.leaseMs, id);
    return true;
  }

  renew(ids) {
    this.prune();
    if (!Array.isArray(ids) || ids.length > bootstrap.server.maxConnections) throw new Error('Invalid lease batch');
    const renewed = [];
    for (const id of ids) {
      if (this.ctx.storage.sql.exec('SELECT id FROM leases WHERE id = ?', id).toArray().length) {
        this.ctx.storage.sql.exec('UPDATE leases SET expires = ? WHERE id = ?', Date.now() + policy.leaseMs, id);
        renewed.push(id);
      }
    }
    return renewed;
  }

  release(id) { this.ctx.storage.sql.exec('DELETE FROM leases WHERE id = ?', id); }

  async allowTurn(subject) {
    this.prune();
    const key = `turn:${subject}`;
    const sql = this.ctx.storage.sql;
    if (!sql.exec('SELECT id FROM windows WHERE id = ?', key).toArray().length
      && sql.exec("SELECT COUNT(*) AS count FROM windows WHERE id LIKE 'turn:%'").one().count >= policy.turnMaxSubjects) return false;
    if (!this.consume('turn-total', policy.turnTotalPerWindow, policy.turnWindowMs)) return false;
    const allowed = this.consume(key, policy.turnPerSubject, policy.turnWindowMs);
    await this.arm();
    return allowed;
  }

  async arm() {
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + bootstrap.server.heartbeatInterval);
  }

  async alarm() {
    this.prune();
    const sql = this.ctx.storage.sql;
    if (sql.exec('SELECT COUNT(*) AS count FROM leases').one().count || sql.exec('SELECT COUNT(*) AS count FROM windows').one().count) {
      await this.ctx.storage.setAlarm(Date.now() + bootstrap.server.heartbeatInterval);
    }
  }
}
