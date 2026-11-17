import crypto from 'crypto';
import { DbClient } from './db';
import { AuditEntry } from './types';

export interface AppendAuditParams {
  userId: string | null;
  userEmail: string | null;
  userRole: string | null;
  action: string;
  projectId: string | null;
  details: string;
  rationale?: string | null;
  expiryDate?: string | null;
  sourceIp?: string | null;
  isDemo?: boolean;
}

export function computeAuditHash(params: {
  seqNum: number;
  createdAt: string;
  userId: string | null;
  userRole: string | null;
  action: string;
  projectId: string | null;
  details: string;
  rationale: string | null;
  expiryDate: string | null;
  sourceIp: string | null;
  prevHash: string;
}): string {
  const canonical = [
    String(params.seqNum),
    params.createdAt,
    params.userId ?? '',
    params.userRole ?? '',
    params.action,
    params.projectId ?? '',
    params.details,
    params.rationale ?? '',
    params.expiryDate ?? '',
    params.sourceIp ?? '',
    params.prevHash,
  ].join('|');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export async function appendAuditLog(
  db: DbClient,
  params: AppendAuditParams
): Promise<AuditEntry> {
  const createdAt = new Date().toISOString();
  const rationale = params.rationale ?? null;
  const expiryDate = params.expiryDate ?? null;
  const sourceIp = params.sourceIp ?? '127.0.0.1';
  const isDemo = params.isDemo ?? false;

  if (db.isPostgres) {
    // Use the PostgreSQL SECURITY DEFINER function that locks audit_chain_head (FOR UPDATE)
    return db.withTransaction(async (tx) => {
      const head = await tx.get<{ last_seq_num: number; last_hash: string }>(
        `SELECT last_seq_num, last_hash FROM audit_chain_head WHERE id = 1 FOR UPDATE`
      );
      const nextSeq = (head?.last_seq_num ?? 0) + 1;
      const prevHash = head?.last_hash ?? 'GENESIS';
      const entryHash = computeAuditHash({
        seqNum: nextSeq,
        createdAt,
        userId: params.userId,
        userRole: params.userRole,
        action: params.action,
        projectId: params.projectId,
        details: params.details,
        rationale,
        expiryDate,
        sourceIp,
        prevHash,
      });

      const rows = await tx.query<{ seq_num: number; prev_hash: string; entry_hash: string }>(
        `SELECT seq_num, prev_hash, entry_hash FROM append_audit_entry(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createdAt,
          params.userId,
          params.userEmail,
          params.userRole,
          params.action,
          params.projectId,
          params.details,
          rationale,
          expiryDate,
          sourceIp,
          isDemo,
          entryHash,
        ]
      );
      const row = rows[0];
      return {
        seq_num: row.seq_num,
        created_at: createdAt,
        user_id: params.userId,
        user_email: params.userEmail,
        user_role: params.userRole,
        action: params.action,
        project_id: params.projectId,
        details: params.details,
        rationale,
        expiry_date: expiryDate,
        source_ip: sourceIp,
        prev_hash: row.prev_hash,
        entry_hash: row.entry_hash,
        is_demo: isDemo,
      };
    });
  }

  // SQLite atomic transaction with single chain-head row
  return db.withTransaction(async (tx) => {
    const head = await tx.get<{ last_seq_num: number; last_hash: string }>(
      `SELECT last_seq_num, last_hash FROM audit_chain_head WHERE id = 1`
    );
    const nextSeq = (head?.last_seq_num ?? 0) + 1;
    const prevHash = head?.last_hash ?? 'GENESIS';
    const entryHash = computeAuditHash({
      seqNum: nextSeq,
      createdAt,
      userId: params.userId,
      userRole: params.userRole,
      action: params.action,
      projectId: params.projectId,
      details: params.details,
      rationale,
      expiryDate,
      sourceIp,
      prevHash,
    });

    await tx.execute(
      `INSERT INTO audit_logs (
        seq_num, created_at, user_id, user_email, user_role, action, project_id,
        details, rationale, expiry_date, source_ip, prev_hash, entry_hash, is_demo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextSeq,
        createdAt,
        params.userId,
        params.userEmail,
        params.userRole,
        params.action,
        params.projectId,
        params.details,
        rationale,
        expiryDate,
        sourceIp,
        prevHash,
        entryHash,
        isDemo ? 1 : 0,
      ]
    );

    await tx.execute(
      `UPDATE audit_chain_head SET last_seq_num = ?, last_hash = ? WHERE id = 1`,
      [nextSeq, entryHash]
    );

    return {
      seq_num: nextSeq,
      created_at: createdAt,
      user_id: params.userId,
      user_email: params.userEmail,
      user_role: params.userRole,
      action: params.action,
      project_id: params.projectId,
      details: params.details,
      rationale,
      expiry_date: expiryDate,
      source_ip: sourceIp,
      prev_hash: prevHash,
      entry_hash: entryHash,
      is_demo: isDemo,
    };
  });
}

export async function verifyAuditChain(db: DbClient): Promise<{
  valid: boolean;
  totalEntries: number;
  brokenAtSeq: number | null;
  reason: string | null;
}> {
  const rows = await db.query<AuditEntry>(
    `SELECT seq_num, created_at, user_id, user_email, user_role, action, project_id,
            details, rationale, expiry_date, source_ip, prev_hash, entry_hash, is_demo
     FROM audit_logs ORDER BY seq_num ASC`
  );

  let expectedPrevHash = 'GENESIS';
  let expectedSeq = 1;

  for (const row of rows) {
    if (Number(row.seq_num) !== expectedSeq) {
      return {
        valid: false,
        totalEntries: rows.length,
        brokenAtSeq: expectedSeq,
        reason: `Sequence gap or fork detected: expected seq ${expectedSeq}, found ${row.seq_num}.`,
      };
    }
    if (row.prev_hash !== expectedPrevHash) {
      return {
        valid: false,
        totalEntries: rows.length,
        brokenAtSeq: row.seq_num,
        reason: `Broken previous-hash link at seq ${row.seq_num}.`,
      };
    }
    const recomputed = computeAuditHash({
      seqNum: Number(row.seq_num),
      createdAt: row.created_at,
      userId: row.user_id,
      userRole: row.user_role,
      action: row.action,
      projectId: row.project_id,
      details: row.details,
      rationale: row.rationale,
      expiryDate: row.expiry_date,
      sourceIp: row.source_ip,
      prevHash: row.prev_hash,
    });
    if (recomputed !== row.entry_hash) {
      return {
        valid: false,
        totalEntries: rows.length,
        brokenAtSeq: row.seq_num,
        reason: `SHA-256 hash mismatch at seq ${row.seq_num}: record contents were altered.`,
      };
    }
    expectedPrevHash = row.entry_hash;
    expectedSeq += 1;
  }

  return {
    valid: true,
    totalEntries: rows.length,
    brokenAtSeq: null,
    reason: null,
  };
}
