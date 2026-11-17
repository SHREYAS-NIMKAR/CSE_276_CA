import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { appendAuditLog } from './audit';
import { AppConfig } from './config';
import { DbClient } from './db';
import { UserRecord, UserRole } from './types';

export const SESSION_COOKIE_NAME = 'ai_gov_session';

export interface AuthenticatedRequest extends Request {
  user?: UserRecord;
  sessionId?: string;
  csrfToken?: string;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

export async function checkLoginRateLimit(
  db: DbClient,
  identifier: string,
  config: AppConfig
): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const row = await db.get<{
    identifier: string;
    failure_count: number;
    first_failure_at: string;
    locked_until: string | null;
  }>(`SELECT * FROM login_attempts WHERE identifier = ?`, [identifier]);

  if (!row) return { locked: false, retryAfterSeconds: 0 };

  if (row.locked_until) {
    const lockedUntilMs = new Date(row.locked_until).getTime();
    if (lockedUntilMs > Date.now()) {
      return {
        locked: true,
        retryAfterSeconds: Math.ceil((lockedUntilMs - Date.now()) / 1000),
      };
    }
    // Lock expired -> reset
    await db.execute(`DELETE FROM login_attempts WHERE identifier = ?`, [identifier]);
    return { locked: false, retryAfterSeconds: 0 };
  }

  // Expire window after 10 minutes
  if (Date.now() - new Date(row.first_failure_at).getTime() > 10 * 60 * 1000) {
    await db.execute(`DELETE FROM login_attempts WHERE identifier = ?`, [identifier]);
  }
  return { locked: false, retryAfterSeconds: 0 };
}

export async function recordLoginFailure(
  db: DbClient,
  identifier: string,
  config: AppConfig
): Promise<{ locked: boolean; attemptsRemaining: number }> {
  const now = new Date();
  const row = await db.get<{
    identifier: string;
    failure_count: number;
    first_failure_at: string;
    locked_until: string | null;
  }>(`SELECT * FROM login_attempts WHERE identifier = ?`, [identifier]);

  if (!row) {
    await db.execute(
      `INSERT INTO login_attempts (identifier, failure_count, first_failure_at, locked_until)
       VALUES (?, 1, ?, NULL)`,
      [identifier, now.toISOString()]
    );
    return { locked: false, attemptsRemaining: config.loginMaxFailures - 1 };
  }

  const nextCount = row.failure_count + 1;
  if (nextCount >= config.loginMaxFailures) {
    const lockedUntil = new Date(now.getTime() + config.loginLockoutSeconds * 1000).toISOString();
    await db.execute(
      `UPDATE login_attempts SET failure_count = ?, locked_until = ? WHERE identifier = ?`,
      [nextCount, lockedUntil, identifier]
    );
    return { locked: true, attemptsRemaining: 0 };
  }

  await db.execute(`UPDATE login_attempts SET failure_count = ? WHERE identifier = ?`, [
    nextCount,
    identifier,
  ]);
  return { locked: false, attemptsRemaining: config.loginMaxFailures - nextCount };
}

export async function clearLoginFailures(db: DbClient, identifier: string): Promise<void> {
  await db.execute(`DELETE FROM login_attempts WHERE identifier = ?`, [identifier]);
}

export async function createSession(
  db: DbClient,
  userId: string,
  config: AppConfig,
  req?: Request
): Promise<{ sessionId: string; csrfToken: string; expiresAt: string }> {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + config.sessionLifetimeSeconds * 1000).toISOString();

  await db.execute(
    `INSERT INTO sessions (id, user_id, csrf_token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionId, userId, csrfToken, expiresAt, nowIso]
  );

  const ip = req ? getClientIp(req) : '127.0.0.1';
  const ua = req && typeof req.headers['user-agent'] === 'string'
    ? req.headers['user-agent'].slice(0, 300)
    : 'Unknown';

  await db.execute(
    `INSERT INTO session_activity (session_id, ip_address, user_agent, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    [sessionId, ip, ua, nowIso]
  );

  return { sessionId, csrfToken, expiresAt };
}

export async function resolveOptionalSessionUser(
  db: DbClient,
  req: Request
): Promise<{ id: string; email: string } | null> {
  const cookieSid = req.cookies?.[SESSION_COOKIE_NAME];
  const headerSid =
    typeof req.headers['x-session-token'] === 'string'
      ? req.headers['x-session-token'].trim()
      : '';
  const authHeader =
    typeof req.headers.authorization === 'string' &&
    req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : '';
  const sid = (typeof cookieSid === 'string' && cookieSid) || headerSid || authHeader;
  if (!sid) return null;
  const row = await db.get<{ id: string; email: string; expires_at: string }>(
    `SELECT u.id, u.email, s.expires_at
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND u.is_active = ?`,
    [sid, db.isPostgres ? true : 1]
  );
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return { id: row.id, email: row.email };
}

function isHttpsRequest(req?: Request): boolean {
  if (!req) return false;
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string') {
    return proto.split(',')[0].trim().toLowerCase() === 'https';
  }
  return false;
}

export function setSessionCookie(
  res: Response,
  req: Request,
  sessionId: string,
  config: AppConfig
) {
  const isSecure = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: isSecure ? 'none' : 'lax',
    secure: isSecure,
    maxAge: config.sessionLifetimeSeconds * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response, req?: Request) {
  const isSecure = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    sameSite: isSecure ? 'none' : 'lax',
    secure: isSecure,
  });
}

export function createAuthMiddleware(db: DbClient) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const cookieSid = req.cookies?.[SESSION_COOKIE_NAME];
    const headerSid =
      typeof req.headers['x-session-token'] === 'string'
        ? req.headers['x-session-token'].trim()
        : '';
    const authHeader =
      typeof req.headers.authorization === 'string' &&
      req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.slice(7).trim()
        : '';
    const sid = (typeof cookieSid === 'string' && cookieSid) || headerSid || authHeader;
    if (!sid) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }

    const row = await db.get<{
      session_id: string;
      csrf_token: string;
      expires_at: string;
      id: string;
      email: string;
      full_name: string;
      role: UserRole;
      is_active: number | boolean;
      force_password_change: number | boolean;
      is_demo: number | boolean;
      created_at: string;
    }>(
      `SELECT s.id as session_id, s.csrf_token, s.expires_at,
              u.id, u.email, u.full_name, u.role, u.is_active, u.force_password_change, u.is_demo, u.created_at
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ?`,
      [sid]
    );

    if (!row) {
      clearSessionCookie(res, req);
      return res.status(401).json({ error: 'Session not found. Please sign in again.' });
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await db.execute(`DELETE FROM sessions WHERE id = ?`, [sid]);
      clearSessionCookie(res, req);
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }

    if (!row.is_active) {
      return res.status(403).json({ error: 'This user account has been deactivated.' });
    }

    req.user = {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      role: row.role,
      is_active: Boolean(row.is_active),
      force_password_change: Boolean(row.force_password_change),
      is_demo: Boolean(row.is_demo),
      created_at: row.created_at,
    };
    req.sessionId = row.session_id;
    req.csrfToken = row.csrf_token;

    await db.execute(
      `UPDATE session_activity SET last_seen_at = ? WHERE session_id = ?`,
      [new Date().toISOString(), row.session_id]
    );

    // CSRF protection on all state-changing requests
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
      const provided = req.headers['x-csrf-token'];
      if (!provided || provided !== row.csrf_token) {
        await appendAuditLog(db, {
          userId: req.user.id,
          userEmail: req.user.email,
          userRole: req.user.role,
          action: 'CSRF_REJECTED',
          projectId: null,
          details: `CSRF validation failed on ${req.method} ${req.path}.`,
          sourceIp: getClientIp(req),
          isDemo: req.user.is_demo,
        });
        return res.status(403).json({ error: 'Invalid or missing CSRF token. Refresh the page and try again.' });
      }
    }

    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied: requires one of [${roles.join(', ')}], your role is ${req.user.role}.`,
      });
    }
    next();
  };
}
