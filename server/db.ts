import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';

export interface DbClient {
  isPostgres: boolean;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  execScript(sql: string): Promise<void>;
  withTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function toPgPlaceholders(sql: string): string {
  let idx = 0;
  let inSingle = false;
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && sql[i - 1] !== '\\') {
      inSingle = !inSingle;
      out += ch;
    } else if (ch === '?' && !inSingle) {
      idx += 1;
      out += `$${idx}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function sanitizeParams(params: unknown[]): (string | number | null | Uint8Array)[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'string' || typeof p === 'number' || p instanceof Uint8Array) return p;
    return JSON.stringify(p);
  });
}

function sanitizePgParams(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

export async function createDatabase(databaseUrl: string): Promise<DbClient> {
  const isPostgres =
    databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://');

  if (isPostgres) {
    const needsSsl =
      /sslmode=(require|verify-full|verify-ca|prefer)/i.test(databaseUrl) ||
      !/\/\/[^/]*@(localhost|127\.0\.0\.1|postgres)(:|\/|$)/i.test(databaseUrl);
    const pool = new Pool({
      connectionString: databaseUrl,
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    const makeTxClient = (client: import('pg').PoolClient): DbClient => ({
      isPostgres: true,
      async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
        const res = await client.query(toPgPlaceholders(sql), sanitizePgParams(params));
        return res.rows as T[];
      },
      async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
        const res = await client.query(toPgPlaceholders(sql), sanitizePgParams(params));
        return (res.rows[0] as T) ?? null;
      },
      async execute(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
        const res = await client.query(toPgPlaceholders(sql), sanitizePgParams(params));
        return { changes: res.rowCount ?? 0 };
      },
      async execScript(sql: string): Promise<void> {
        await client.query(sql);
      },
      async withTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
        return fn(makeTxClient(client));
      },
      async close(): Promise<void> {},
    });

    const db: DbClient = {
      isPostgres: true,
      async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
        const res = await pool.query(toPgPlaceholders(sql), sanitizePgParams(params));
        return res.rows as T[];
      },
      async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
        const res = await pool.query(toPgPlaceholders(sql), sanitizePgParams(params));
        return (res.rows[0] as T) ?? null;
      },
      async execute(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
        const res = await pool.query(toPgPlaceholders(sql), sanitizePgParams(params));
        return { changes: res.rowCount ?? 0 };
      },
      async execScript(sql: string): Promise<void> {
        await pool.query(sql);
      },
      async withTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(makeTxClient(client));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      async close(): Promise<void> {
        await pool.end();
      },
    };

    const migrationSql = fs.readFileSync(
      path.resolve(process.cwd(), 'server/migrations/001_postgres.sql'),
      'utf8'
    );
    await db.execScript(migrationSql);
    return db;
  }

  // SQLite path
  let filePath = databaseUrl.startsWith('sqlite:')
    ? databaseUrl.slice('sqlite:'.length)
    : databaseUrl;
  if (filePath !== ':memory:') {
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    filePath = resolved;
  }

  const sqlite = new DatabaseSync(filePath);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');

  let txQueue: Promise<unknown> = Promise.resolve();

  const db: DbClient = {
    isPostgres: false,
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const stmt = sqlite.prepare(sql);
      return stmt.all(...sanitizeParams(params)) as T[];
    },
    async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
      const stmt = sqlite.prepare(sql);
      const row = stmt.get(...sanitizeParams(params)) as T | undefined;
      return row ?? null;
    },
    async execute(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
      const stmt = sqlite.prepare(sql);
      const res = stmt.run(...sanitizeParams(params));
      return { changes: Number(res.changes ?? 0) };
    },
    async execScript(sql: string): Promise<void> {
      sqlite.exec(sql);
    },
    async withTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      const run = async (): Promise<T> => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const txClient: DbClient = {
            ...db,
            async withTransaction<U>(innerFn: (tx: DbClient) => Promise<U>): Promise<U> {
              return innerFn(txClient);
            },
          };
          const out = await fn(txClient);
          sqlite.exec('COMMIT');
          return out;
        } catch (err) {
          try {
            sqlite.exec('ROLLBACK');
          } catch {
            // ignore rollback error if already rolled back
          }
          throw err;
        }
      };
      const next = txQueue.then(run, run);
      txQueue = next.catch(() => {});
      return next;
    },
    async close(): Promise<void> {
      sqlite.close();
    },
  };

  const migrationSql = fs.readFileSync(
    path.resolve(process.cwd(), 'server/migrations/001_sqlite.sql'),
    'utf8'
  );
  await db.execScript(migrationSql);
  await db.execute(
    `INSERT OR IGNORE INTO audit_chain_head (id, last_seq_num, last_hash) VALUES (1, 0, 'GENESIS')`
  );

  return db;
}
