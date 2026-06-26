import { Pool } from 'pg';
import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// Database config from env
const usePostgres = process.env.DB_TYPE === 'postgres' || !!process.env.DATABASE_URL;

let pgPool: Pool | null = null;
let sqliteDb: sqlite3.Database | null = null;

export async function initDb() {
  if (usePostgres) {
    console.log('Database Mode: PostgreSQL');
    const connectionString = process.env.DATABASE_URL;
    pgPool = new Pool({
      connectionString,
      user: process.env.PGUSER || 'postgres',
      host: process.env.PGHOST || 'localhost',
      database: process.env.PGDATABASE || 'netmon',
      password: process.env.PGPASSWORD || 'postgres',
      port: parseInt(process.env.PGPORT || '5432'),
    });
    
    // Create tables in Postgres
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      try {
        await query(schemaSql);
        console.log('PostgreSQL schema applied successfully.');
      } catch (err) {
        console.error('Error applying PostgreSQL schema:', err);
      }
    }
  } else {
    console.log('Database Mode: SQLite (Local Fallback)');
    const dbPath = path.resolve(__dirname, '../../database.sqlite');
    sqliteDb = new sqlite3.Database(dbPath);
    
    // Promisified run for SQLite schema init
    const run = (sql: string) => new Promise<void>((resolve, reject) => {
      sqliteDb!.run(sql, (err) => err ? reject(err) : resolve());
    });

    try {
      // Create SQLite schemas (dialect-adjusted)
      await run(`
        CREATE TABLE IF NOT EXISTS sites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          network_cidr TEXT NOT NULL,
          address_notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id INTEGER NOT NULL,
          friendly_name TEXT NOT NULL,
          type TEXT DEFAULT 'unclassified',
          mac_address TEXT UNIQUE NOT NULL,
          current_ip TEXT NOT NULL,
          location_dept TEXT,
          asset_tag TEXT,
          notes TEXT,
          source TEXT DEFAULT 'discovered',
          last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
        );
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS device_credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id INTEGER NOT NULL,
          protocol TEXT NOT NULL,
          auth_details TEXT NOT NULL,
          FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS ping_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id INTEGER NOT NULL,
          timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          is_online BOOLEAN NOT NULL,
          latency_ms INTEGER,
          FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS interface_traffic (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id INTEGER NOT NULL,
          interface_name TEXT NOT NULL,
          timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          rx_bytes_counter INTEGER NOT NULL,
          tx_bytes_counter INTEGER NOT NULL,
          FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS topology_edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id INTEGER NOT NULL,
          switch_device_id INTEGER,
          switch_port TEXT NOT NULL,
          connected_device_id INTEGER,
          last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_manual BOOLEAN DEFAULT 0,
          UNIQUE (switch_device_id, switch_port, connected_device_id),
          FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
          FOREIGN KEY(switch_device_id) REFERENCES devices(id) ON DELETE CASCADE,
          FOREIGN KEY(connected_device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS printer_status (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id INTEGER UNIQUE NOT NULL,
          toner_levels TEXT NOT NULL,
          paper_status TEXT DEFAULT 'OK',
          page_count INTEGER DEFAULT 0,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
        );
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS isp_health_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id INTEGER NOT NULL,
          timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ping_latency_ms INTEGER,
          dns_latency_ms INTEGER,
          packet_loss INTEGER,
          FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
        );
      `);

      await run(`
        CREATE INDEX IF NOT EXISTS idx_isp_health_time ON isp_health_history(site_id, timestamp DESC);
      `);

      console.log('SQLite schema applied successfully.');
    } catch (err) {
      console.error('Error applying SQLite schema:', err);
    }
  }
}

// Unified query wrapper supporting both PG and SQLite
export function query(sql: string, params: any[] = []): Promise<any> {
  // Convert Postgres syntax $1, $2 to SQLite ? syntax if using SQLite
  let querySql = sql;
  if (!usePostgres) {
    querySql = sql.replace(/\$(\d+)/g, '?');
  }

  return new Promise((resolve, reject) => {
    if (usePostgres) {
      pgPool!.query(querySql, params, (err, res) => {
        if (err) return reject(err);
        resolve(res.rows);
      });
    } else {
      // Check if it is a SELECT query
      const isSelect = querySql.trim().toUpperCase().startsWith('SELECT');
      if (isSelect) {
        sqliteDb!.all(querySql, params, (err, rows) => {
          if (err) return reject(err);
          // SQLite returns fields as-is, make output format match Postgres rows
          resolve(rows);
        });
      } else {
        sqliteDb!.run(querySql, params, function(err) {
          if (err) return reject(err);
          // Return an object that looks like Postgres result if needed
          // e.g. for INSERT, we might need the lastID
          resolve({ lastID: this.lastID, changes: this.changes });
        });
      }
    }
  });
}
