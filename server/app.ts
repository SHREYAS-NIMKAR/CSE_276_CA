import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import express, { Express, Response } from 'express';
import fs from 'fs';
import helmet from 'helmet';
import multer from 'multer';
import path from 'path';
import { appendAuditLog, verifyAuditChain } from './audit';
import {
  AuthenticatedRequest,
  checkLoginRateLimit,
  clearLoginFailures,
  clearSessionCookie,
  createAuthMiddleware,
  createSession,
  getClientIp,
  hashPassword,
  recordLoginFailure,
  requireRole,
  resolveOptionalSessionUser,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  verifyPassword,
} from './auth';
import { AppConfig } from './config';
import { DbClient } from './db';
import { runBenchmarkEvaluation } from './evaluation';
import { ARTEFACTS, buildProjectJsonLd, getKnowledgeGraphPayload } from './knowledge';
import { buildCsv, buildOpenApiSpec, generateProjectReportPdf } from './reports';
import { retrievePolicyClauses } from './retrieval';
import { DEFAULT_SETTINGS } from './seedData';
import { runSelfTestSuite } from './selfTests';
import {
  AssessmentResult,
  AuditEntry,
  CohortMetricEntry,
  EvidenceStatus,
  ExceptionRecord,
  PolicyClause,
  ProjectRecord,
  ReviewCommentRecord,
  RiskAcceptanceRecord,
  RuleDefinition,
  SystemSettings,
  UserRecord,
  UserRole,
  WorkflowState,
} from './types';
import {
  checkAndExpireApprovals,
  loadProjectAssessmentContext,
  runAndPersistAssessment,
  validateFormalRiskAcceptance,
  validateProjectPayload,
  validateWorkflowTransition,
} from './workflow';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.csv', '.json', '.png', '.jpg', '.jpeg']);

export function createApp(db: DbClient, config: AppConfig): Express {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      frameguard: false,
    })
  );
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  if (config.allowedOrigins.length > 0) {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && config.allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, X-CSRF-Token, X-Session-Token, Authorization'
        );
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  fs.mkdirSync(config.uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, config.uploadDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: config.maxUploadBytes },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return cb(
          new Error(
            `Unsupported file type "${ext}". Allowed types: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}.`
          )
        );
      }
      cb(null, true);
    },
  });

  const requireAuth = createAuthMiddleware(db);

  // Public health & OpenAPI docs
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', database: config.isPostgres ? 'postgresql' : 'sqlite' });
  });

  app.get('/api/openapi.json', (_req, res) => {
    res.json(buildOpenApiSpec());
  });

  app.get('/api/docs', (_req, res) => {
    const spec = buildOpenApiSpec();
    const pathsHtml = Object.entries(spec.paths)
      .map(
        ([p, ops]) =>
          `<li><code>${p}</code> — ${Object.entries(ops)
            .map(([m, d]) => `<strong>${m.toUpperCase()}</strong>: ${(d as { summary: string }).summary}`)
            .join(' | ')}</li>`
      )
      .join('');
    res.type('html').send(
      `<!doctype html><html><head><title>API Docs</title><style>body{font-family:sans-serif;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.6}code{background:#f1f5f9;padding:2px 6px;border-radius:4px}</style></head><body><h1>${spec.info.title}</h1><p>${spec.info.description}</p><p><a href="/api/openapi.json">Download OpenAPI 3.0.3 JSON</a></p><ul>${pathsHtml}</ul></body></html>`
    );
  });

  // ---- AUTHENTICATION ----
  app.get('/api/auth/setup-status', async (_req, res) => {
    const totalUsersRow = await db.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM users`);
    const demoUsersRow = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM users WHERE is_demo = ?`,
      [db.isPostgres ? true : 1]
    );
    const demoProjectsRow = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM projects WHERE is_demo = ?`,
      [db.isPostgres ? true : 1]
    );
    const realAdminRow = await db.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM users WHERE role = 'ADMIN' AND is_active = ? AND is_demo = ?`,
      [db.isPostgres ? true : 1, db.isPostgres ? false : 0]
    );
    res.json({
      needsInitialSetup: Number(totalUsersRow?.cnt ?? 0) === 0,
      hasRealAdmin: Number(realAdminRow?.cnt ?? 0) > 0,
      hasDemoData: Number(demoUsersRow?.cnt ?? 0) > 0 || Number(demoProjectsRow?.cnt ?? 0) > 0,
    });
  });

  app.post('/api/auth/bootstrap', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address (e.g. your Gmail) is required.' });
    }
    if (fullName.length < 2) {
      return res.status(400).json({ error: 'Full name is required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const id = `user-${crypto.randomBytes(5).toString('hex')}`;
    const now = new Date().toISOString();

    const created = await db.withTransaction(async (tx) => {
      const existingCount = await tx.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM users`);
      if (Number(existingCount?.cnt ?? 0) > 0) {
        return false;
      }
      await tx.execute(
        `INSERT INTO users (id, email, full_name, password_hash, role, is_active, force_password_change, is_demo, created_at)
         VALUES (?, ?, ?, ?, 'ADMIN', ?, ?, ?, ?)`,
        [
          id,
          email,
          fullName,
          hashPassword(password),
          tx.isPostgres ? true : 1,
          tx.isPostgres ? false : 0,
          tx.isPostgres ? false : 0,
          now,
        ]
      );
      return true;
    });

    if (!created) {
      return res.status(409).json({
        error: 'Workspace already has registered users. Sign in or ask an administrator to register your account.',
      });
    }

    const session = await createSession(db, id, config, req);
    setSessionCookie(res, req, session.sessionId, config);

    await appendAuditLog(db, {
      userId: id,
      userEmail: email,
      userRole: 'ADMIN',
      action: 'ADMIN_BOOTSTRAPPED',
      projectId: null,
      details: `Initialized real governance workspace with administrator ${email}.`,
      sourceIp: getClientIp(req),
      isDemo: false,
    });

    res.status(201).json({
      user: {
        id,
        email,
        full_name: fullName,
        role: 'ADMIN' as const,
        is_active: true,
        force_password_change: false,
        is_demo: false,
        created_at: now,
      },
      csrfToken: session.csrfToken,
      sessionToken: session.sessionId,
      expiresAt: session.expiresAt,
    });
  });

  app.post('/api/visits', async (req, res) => {
    const ip = getClientIp(req);
    const ua =
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent'].slice(0, 300)
        : 'Unknown';
    const rawPath = typeof req.body?.path === 'string' ? req.body.path.trim().slice(0, 200) : '/';
    const referrer =
      typeof req.body?.referrer === 'string' ? req.body.referrer.trim().slice(0, 300) : null;
    const optUser = await resolveOptionalSessionUser(db, req);
    const id = `vis-${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO site_visits (id, visited_at, ip_address, user_agent, path, referrer, user_id, user_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, now, ip, ua, rawPath || '/', referrer || null, optUser?.id ?? null, optUser?.email ?? null]
    );
    res.status(201).json({ ok: true });
  });

  app.post('/api/auth/request-access', async (req, res) => {
    const ip = getClientIp(req);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
    const requestedRole = (req.body?.requested_role || 'PROJECT_OWNER') as UserRole;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (fullName.length < 2) {
      return res.status(400).json({ error: 'Full name is required.' });
    }
    if (!['PROJECT_OWNER', 'REVIEWER', 'RISK_ACCEPTANCE_AUTHORITY'].includes(requestedRole)) {
      return res.status(400).json({ error: 'Please choose a valid governance role.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }
    if (reason.length < 5) {
      return res.status(400).json({ error: 'Please briefly describe your team or reason for access.' });
    }

    const existingUser = await db.get(`SELECT id FROM users WHERE LOWER(email) = ?`, [email]);
    if (existingUser) {
      return res.status(409).json({
        error: 'An account with this email already exists. Please sign in or ask an administrator for a password reset.',
      });
    }

    const pendingReq = await db.get(
      `SELECT id FROM access_requests WHERE LOWER(email) = ? AND status = 'Pending'`,
      [email]
    );
    if (pendingReq) {
      return res.status(409).json({
        error: 'An access request for this email is already pending administrator review.',
      });
    }

    const id = `ar-${crypto.randomBytes(5).toString('hex')}`;
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO access_requests (
        id, email, full_name, password_hash, requested_role, reason, status, source_ip, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`,
      [id, email, fullName, hashPassword(password), requestedRole, reason.slice(0, 500), ip, now]
    );

    await appendAuditLog(db, {
      userId: null,
      userEmail: email,
      userRole: 'VISITOR',
      action: 'ACCESS_REQUESTED',
      projectId: null,
      details: `${fullName} (${email}) requested ${requestedRole} access: ${reason.slice(0, 180)}`,
      sourceIp: ip,
      isDemo: false,
    });

    res.status(201).json({
      id,
      status: 'Pending',
      message: 'Access request submitted. Once an administrator approves it, you can sign in with your email and chosen password.',
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const ip = getClientIp(req);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const rateKey = `${ip}:${email}`;
    const limitCheck = await checkLoginRateLimit(db, rateKey, config);
    if (limitCheck.locked) {
      return res.status(429).json({
        error: `Too many failed sign-in attempts. Please wait ${limitCheck.retryAfterSeconds} seconds before trying again.`,
      });
    }

    const user = await db.get<UserRecord & { password_hash: string }>(
      `SELECT * FROM users WHERE LOWER(email) = ?`,
      [email]
    );

    if (!user || !verifyPassword(password, user.password_hash)) {
      const failRes = await recordLoginFailure(db, rateKey, config);
      await appendAuditLog(db, {
        userId: user?.id ?? null,
        userEmail: email,
        userRole: user?.role ?? 'UNKNOWN',
        action: 'LOGIN_FAILED',
        projectId: null,
        details: failRes.locked
          ? `Failed login triggered temporary account lockout.`
          : `Failed login attempt (${failRes.attemptsRemaining} attempts remaining before lockout).`,
        sourceIp: ip,
        isDemo: Boolean(user?.is_demo),
      });
      return res.status(401).json({
        error: failRes.locked
          ? `Account temporarily locked for ${config.loginLockoutSeconds} seconds due to repeated failed attempts.`
          : 'Invalid email or password.',
      });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated. Contact an administrator.' });
    }

    await clearLoginFailures(db, rateKey);
    const session = await createSession(db, user.id, config, req);
    setSessionCookie(res, req, session.sessionId, config);

    await appendAuditLog(db, {
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: 'LOGIN_SUCCESS',
      projectId: null,
      details: `Signed in successfully.`,
      sourceIp: ip,
      isDemo: Boolean(user.is_demo),
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        is_active: Boolean(user.is_active),
        force_password_change: Boolean(user.force_password_change),
        is_demo: Boolean(user.is_demo),
        created_at: user.created_at,
      },
      csrfToken: session.csrfToken,
      sessionToken: session.sessionId,
      expiresAt: session.expiresAt,
    });
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    res.json({
      user: req.user,
      csrfToken: req.csrfToken,
      sessionToken: req.sessionId,
    });
  });

  app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const sid = req.sessionId || req.cookies?.[SESSION_COOKIE_NAME];
    if (sid) {
      await db.execute(`DELETE FROM sessions WHERE id = ?`, [sid]);
    }
    clearSessionCookie(res, req);
    await appendAuditLog(db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      action: 'LOGOUT',
      projectId: null,
      details: 'Signed out.',
      sourceIp: getClientIp(req),
      isDemo: req.user!.is_demo,
    });
    res.json({ ok: true });
  });

  app.post('/api/auth/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    }
    const row = await db.get<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, [
      req.user!.id,
    ]);
    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    await db.execute(
      `UPDATE users SET password_hash = ?, force_password_change = ? WHERE id = ?`,
      [hashPassword(newPassword), db.isPostgres ? false : 0, req.user!.id]
    );
    await appendAuditLog(db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      action: 'PASSWORD_CHANGED',
      projectId: null,
      details: 'User updated password.',
      sourceIp: getClientIp(req),
      isDemo: req.user!.is_demo,
    });
    res.json({ ok: true });
  });

  // ---- USERS (Registration by ADMIN only) ----
  app.get('/api/users', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    if (req.user!.role === 'ADMIN') {
      const users = await db.query<UserRecord>(
        `SELECT id, email, full_name, role, is_active, force_password_change, is_demo, created_at FROM users ORDER BY created_at ASC`
      );
      return res.json({
        users: users.map((u) => ({
          ...u,
          is_active: Boolean(u.is_active),
          force_password_change: Boolean(u.force_password_change),
          is_demo: Boolean(u.is_demo),
        })),
      });
    }
    // Non-admins only see reviewer/owner directory names for project assignment
    const directory = await db.query<Pick<UserRecord, 'id' | 'full_name' | 'role' | 'is_demo'>>(
      `SELECT id, full_name, role, is_demo FROM users WHERE is_active = ? ORDER BY full_name ASC`,
      [db.isPostgres ? true : 1]
    );
    res.json({
      users: directory.map((u) => ({ ...u, is_demo: Boolean(u.is_demo) })),
    });
  });

  app.post(
    '/api/users',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const role = req.body?.role as UserRole;
      const forceChange = Boolean(req.body?.force_password_change);

      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'A valid email address is required.' });
      }
      if (fullName.length < 2) {
        return res.status(400).json({ error: 'Full name is required.' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Initial password must be at least 8 characters.' });
      }
      if (!['PROJECT_OWNER', 'REVIEWER', 'ADMIN', 'RISK_ACCEPTANCE_AUTHORITY'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role selected.' });
      }

      const exists = await db.get(`SELECT id FROM users WHERE LOWER(email) = ?`, [email]);
      if (exists) {
        return res.status(409).json({ error: 'A user with this email already exists.' });
      }

      const id = `user-${crypto.randomBytes(5).toString('hex')}`;
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO users (id, email, full_name, password_hash, role, is_active, force_password_change, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          email,
          fullName,
          hashPassword(password),
          role,
          db.isPostgres ? true : 1,
          db.isPostgres ? forceChange : forceChange ? 1 : 0,
          db.isPostgres ? false : 0,
          now,
        ]
      );

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'USER_CREATED',
        projectId: null,
        details: `Created user ${email} with role ${role}${forceChange ? ' (force password change)' : ''}.`,
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });

      res.status(201).json({
        user: {
          id,
          email,
          full_name: fullName,
          role,
          is_active: true,
          force_password_change: forceChange,
          is_demo: false,
          created_at: now,
        },
      });
    }
  );

  app.patch(
    '/api/users/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const targetId = req.params.id;
      const target = await db.get<UserRecord>(`SELECT * FROM users WHERE id = ?`, [targetId]);
      if (!target) return res.status(404).json({ error: 'User not found.' });

      const nextRole = (req.body?.role ?? target.role) as UserRole;
      if (!['PROJECT_OWNER', 'REVIEWER', 'ADMIN', 'RISK_ACCEPTANCE_AUTHORITY'].includes(nextRole)) {
        return res.status(400).json({ error: 'Invalid role.' });
      }
      const nextActive =
        req.body?.is_active !== undefined ? Boolean(req.body.is_active) : Boolean(target.is_active);
      const nextForce =
        req.body?.force_password_change !== undefined
          ? Boolean(req.body.force_password_change)
          : Boolean(target.force_password_change);

      await db.execute(
        `UPDATE users SET role = ?, is_active = ?, force_password_change = ? WHERE id = ?`,
        [
          nextRole,
          db.isPostgres ? nextActive : nextActive ? 1 : 0,
          db.isPostgres ? nextForce : nextForce ? 1 : 0,
          targetId,
        ]
      );

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'USER_UPDATED',
        projectId: null,
        details: `Updated user ${target.email}: role=${nextRole}, active=${nextActive}, force_password_change=${nextForce}.`,
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });

      res.json({ ok: true });
    }
  );

  app.post(
    '/api/users/:id/reset-password',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const targetId = req.params.id;
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
      const forceChange = req.body?.force_password_change !== false;
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'Temporary password must be at least 8 characters long.' });
      }
      const target = await db.get<UserRecord>(`SELECT * FROM users WHERE id = ?`, [targetId]);
      if (!target) return res.status(404).json({ error: 'User not found.' });

      await db.execute(
        `UPDATE users SET password_hash = ?, force_password_change = ? WHERE id = ?`,
        [hashPassword(newPassword), db.isPostgres ? forceChange : forceChange ? 1 : 0, targetId]
      );
      if (targetId !== req.user!.id) {
        await db.execute(`DELETE FROM sessions WHERE user_id = ?`, [targetId]);
      }

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'USER_PASSWORD_RESET',
        projectId: null,
        details: `Administrator reset password for ${target.email}${forceChange ? ' (password change required at next login)' : ''}.`,
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });

      res.json({ ok: true });
    }
  );

  // ---- KNOWLEDGE REPRESENTATION ----
  app.get('/api/knowledge/graph', requireAuth, (_req, res) => {
    res.json(getKnowledgeGraphPayload());
  });

  // ---- PROJECTS ----
  async function canAccessProject(user: UserRecord, project: ProjectRecord): Promise<boolean> {
    if (user.role === 'PROJECT_OWNER') {
      return project.owner_id === user.id;
    }
    return true;
  }

  app.get('/api/projects', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    await checkAndExpireApprovals(db);
    const user = req.user!;
    const rows =
      user.role === 'PROJECT_OWNER'
        ? await db.query<ProjectRecord>(
            `SELECT p.*, uo.full_name as owner_name, uo.email as owner_email,
                    ur.full_name as reviewer_name, ur.email as reviewer_email
             FROM projects p
             JOIN users uo ON p.owner_id = uo.id
             JOIN users ur ON p.assigned_reviewer_id = ur.id
             WHERE p.owner_id = ?
             ORDER BY p.created_at DESC`,
            [user.id]
          )
        : await db.query<ProjectRecord>(
            `SELECT p.*, uo.full_name as owner_name, uo.email as owner_email,
                    ur.full_name as reviewer_name, ur.email as reviewer_email
             FROM projects p
             JOIN users uo ON p.owner_id = uo.id
             JOIN users ur ON p.assigned_reviewer_id = ur.id
             ORDER BY p.created_at DESC`
          );

    const enriched = await Promise.all(
      rows.map(async (p) => {
        const latestRun = await db.get<{ result_json: string }>(
          `SELECT result_json FROM assessment_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
          [p.id]
        );
        const latestAssessment: AssessmentResult | null = latestRun
          ? JSON.parse(latestRun.result_json)
          : null;
        return {
          ...p,
          affects_academic_standing: Boolean(p.affects_academic_standing),
          uses_synthetic_data: Boolean(p.uses_synthetic_data),
          uses_third_party_wrapper: Boolean(p.uses_third_party_wrapper),
          is_low_risk_admin_script: Boolean(p.is_low_risk_admin_script),
          is_demo: Boolean(p.is_demo),
          latestAssessment,
        };
      })
    );

    res.json({ projects: enriched });
  });

  app.post(
    '/api/projects',
    requireAuth,
    requireRole('PROJECT_OWNER', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const errors = validateProjectPayload(req.body);
      if (errors.length > 0) {
        return res.status(422).json({ error: errors.join(' '), details: errors });
      }

      const reviewer = await db.get<UserRecord>(`SELECT * FROM users WHERE id = ?`, [
        req.body.assigned_reviewer_id,
      ]);
      const activeReviewerCountRow = await db.get<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM users WHERE role = 'REVIEWER' AND is_active = ?`,
        [db.isPostgres ? true : 1]
      );
      const hasDedicatedReviewers = Number(activeReviewerCountRow?.cnt ?? 0) > 0;
      if (hasDedicatedReviewers) {
        if (!reviewer || !reviewer.is_active || reviewer.role !== 'REVIEWER') {
          return res.status(400).json({ error: 'Assigned reviewer must be an active REVIEWER user.' });
        }
        if (reviewer.id === req.user!.id) {
          return res.status(400).json({ error: 'Project owner cannot be assigned as their own reviewer.' });
        }
      } else {
        // Solo-admin workspace fallback before a dedicated REVIEWER is invited
        if (!reviewer || !reviewer.is_active || !['REVIEWER', 'ADMIN'].includes(reviewer.role)) {
          return res.status(400).json({
            error: 'Assigned reviewer must be an active REVIEWER or ADMIN user.',
          });
        }
      }

      const id = `proj-${crypto.randomBytes(5).toString('hex')}`;
      const now = new Date().toISOString();

      await db.execute(
        `INSERT INTO projects (
          id, name, description, owner_id, assigned_reviewer_id, deployment_autonomy,
          affects_academic_standing, data_sensitivity, uses_synthetic_data,
          uses_third_party_wrapper, is_low_risk_admin_script, target_user_population,
          workflow_state, is_demo, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?)`,
        [
          id,
          req.body.name.trim(),
          req.body.description.trim(),
          req.user!.id,
          reviewer.id,
          req.body.deployment_autonomy,
          db.isPostgres ? Boolean(req.body.affects_academic_standing) : req.body.affects_academic_standing ? 1 : 0,
          req.body.data_sensitivity,
          db.isPostgres ? Boolean(req.body.uses_synthetic_data) : req.body.uses_synthetic_data ? 1 : 0,
          db.isPostgres ? Boolean(req.body.uses_third_party_wrapper) : req.body.uses_third_party_wrapper ? 1 : 0,
          db.isPostgres ? Boolean(req.body.is_low_risk_admin_script) : req.body.is_low_risk_admin_script ? 1 : 0,
          req.body.target_user_population.trim(),
          db.isPostgres ? false : 0,
          now,
          now,
        ]
      );

      for (const art of ARTEFACTS) {
        await db.execute(
          `INSERT INTO project_evidence (id, project_id, artefact_id, status, notes, updated_by, updated_at)
           VALUES (?, ?, ?, 'Not submitted', '', ?, ?)`,
          [`ev-${id}-${art.id}`, id, art.id, req.user!.id, now]
        );
      }

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'PROJECT_CREATED',
        projectId: id,
        details: `Created project "${req.body.name.trim()}" assigned to reviewer ${reviewer.full_name}.`,
        sourceIp: getClientIp(req),
        isDemo: false,
      });

      const assessment = await runAndPersistAssessment(db, id, req.user!, getClientIp(req));
      res.status(201).json({ id, assessment });
    }
  );

  app.get('/api/projects/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    await checkAndExpireApprovals(db, req.params.id);
    const ctx = await loadProjectAssessmentContext(db, req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Project not found.' });
    if (!(await canAccessProject(req.user!, ctx.project))) {
      return res.status(403).json({ error: 'Access denied: you do not own this project.' });
    }

    const latestRun = await db.get<{ result_json: string }>(
      `SELECT result_json FROM assessment_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
      [ctx.project.id]
    );
    const latestAssessment: AssessmentResult | null = latestRun
      ? JSON.parse(latestRun.result_json)
      : await runAndPersistAssessment(db, ctx.project.id, req.user!, getClientIp(req));

    const comments = (
      await db.query<ReviewCommentRecord>(
        `SELECT rc.*, u.full_name as author_name, u.role as author_role
         FROM review_comments rc
         JOIN users u ON rc.author_id = u.id
         WHERE rc.project_id = ?
         ORDER BY rc.created_at DESC`,
        [ctx.project.id]
      )
    ).map((c) => ({ ...c, is_demo: Boolean(c.is_demo) }));

    res.json({
      project: ctx.project,
      evidence: ctx.evidence,
      fairnessCheck: ctx.fairnessCheck,
      exceptions: ctx.exceptions,
      riskAcceptances: ctx.riskAcceptances,
      comments,
      latestAssessment,
    });
  });

  app.delete(
    '/api/projects/:id',
    requireAuth,
    requireRole('PROJECT_OWNER', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const proj = await db.get<ProjectRecord>(`SELECT * FROM projects WHERE id = ?`, [req.params.id]);
      if (!proj) return res.status(404).json({ error: 'Project not found.' });
      if (req.user!.role !== 'ADMIN' && proj.owner_id !== req.user!.id) {
        return res.status(403).json({ error: 'Only an administrator or the project owner can delete a project.' });
      }
      await db.execute(`DELETE FROM projects WHERE id = ?`, [proj.id]);
      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'PROJECT_DELETED',
        projectId: proj.id,
        details: `Deleted project "${proj.name}" (${proj.id}).`,
        sourceIp: getClientIp(req),
        isDemo: Boolean(proj.is_demo) || req.user!.is_demo,
      });
      res.json({ ok: true });
    }
  );

  app.post('/api/projects/:id/assess', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const ctx = await loadProjectAssessmentContext(db, req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Project not found.' });
    if (!(await canAccessProject(req.user!, ctx.project))) {
      return res.status(403).json({ error: 'Access denied: you do not own this project.' });
    }
    const result = await runAndPersistAssessment(db, ctx.project.id, req.user!, getClientIp(req));
    res.json({ assessment: result });
  });

  // ---- EVIDENCE & FAIRNESS ----
  app.put(
    '/api/projects/:id/evidence/:artefactId',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const ctx = await loadProjectAssessmentContext(db, req.params.id);
      if (!ctx) return res.status(404).json({ error: 'Project not found.' });
      if (!(await canAccessProject(req.user!, ctx.project))) {
        return res.status(403).json({ error: 'Access denied: you do not own this project.' });
      }

      const artDef = ARTEFACTS.find((a) => a.id === req.params.artefactId);
      if (!artDef) return res.status(404).json({ error: 'Unknown artefact ID.' });

      const actor = req.user!;
      const existing = ctx.evidence.find((e) => e.artefact_id === artDef.id);
      const nextStatus = (req.body?.status ?? existing?.status ?? 'Not submitted') as EvidenceStatus;
      if (!['Not submitted', 'Submitted', 'Verified', 'Unclear'].includes(nextStatus)) {
        return res.status(400).json({ error: 'Invalid evidence status.' });
      }

      // Server-enforced RBAC on evidence verification and editing
      if (actor.role === 'RISK_ACCEPTANCE_AUTHORITY') {
        return res.status(403).json({ error: 'Risk Acceptance Authority cannot edit project evidence.' });
      }
      if (actor.role === 'PROJECT_OWNER') {
        if (ctx.project.owner_id !== actor.id) {
          return res.status(403).json({ error: 'Owners can only edit evidence on projects they own.' });
        }
        if (nextStatus === 'Verified') {
          return res.status(403).json({
            error: 'Only an assigned Reviewer may set an artefact status to Verified.',
          });
        }
      }
      if (actor.role === 'REVIEWER') {
        if (ctx.project.owner_id === actor.id) {
          return res.status(403).json({
            error: 'Separation of duties: a reviewer cannot verify artefacts on a project they own.',
          });
        }
        // Reviewer cannot edit owner evidence fields (notes/link/missingness)
        const tryingToEditOwnerFields =
          (req.body?.notes !== undefined && req.body.notes !== (existing?.notes ?? '')) ||
          (req.body?.external_link !== undefined && req.body.external_link !== (existing?.external_link ?? null)) ||
          (req.body?.missingness_pct !== undefined && req.body.missingness_pct !== (existing?.missingness_pct ?? null));
        if (tryingToEditOwnerFields) {
          return res.status(403).json({
            error: 'Reviewers cannot edit owner evidence notes, links, or measurements; use review comments or set status Verified / Unclear.',
          });
        }
        if (nextStatus !== 'Verified' && nextStatus !== 'Unclear') {
          return res.status(403).json({
            error: 'Reviewers may only set artefact status to Verified or Unclear.',
          });
        }
      }

      // Stage 3 fairness gate enforcement for subgroup_error_matrix
      if (artDef.id === 'subgroup_error_matrix' && nextStatus === 'Verified') {
        if (!ctx.fairnessCheck || !ctx.fairnessCheck.passed) {
          return res.status(400).json({
            error:
              'Subgroup Error Matrix cannot be Verified until the Stage 3 fairness parity check passes within tolerance.',
          });
        }
      }

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      const notes =
        actor.role === 'REVIEWER'
          ? existing?.notes ?? ''
          : typeof req.body?.notes === 'string'
          ? req.body.notes
          : existing?.notes ?? '';
      const externalLink =
        actor.role === 'REVIEWER'
          ? existing?.external_link ?? null
          : req.body?.external_link !== undefined
          ? req.body.external_link || null
          : existing?.external_link ?? null;
      const expiryDate =
        actor.role === 'REVIEWER'
          ? existing?.expiry_date ?? null
          : req.body?.expiry_date !== undefined
          ? req.body.expiry_date || null
          : existing?.expiry_date ?? null;
      const missingnessPct =
        actor.role === 'REVIEWER'
          ? existing?.missingness_pct ?? null
          : req.body?.missingness_pct !== undefined && req.body.missingness_pct !== null && req.body.missingness_pct !== ''
          ? Number(req.body.missingness_pct)
          : existing?.missingness_pct ?? null;

      if (missingnessPct !== null && (Number.isNaN(missingnessPct) || missingnessPct < 0 || missingnessPct > 1)) {
        return res.status(400).json({ error: 'Missingness must be a decimal between 0 and 1 (e.g. 0.03 for 3%).' });
      }

      const now = new Date().toISOString();
      if (existing) {
        await db.execute(
          `UPDATE project_evidence
           SET status = ?, notes = ?, external_link = ?, expiry_date = ?, missingness_pct = ?, updated_by = ?, updated_at = ?
           WHERE project_id = ? AND artefact_id = ?`,
          [nextStatus, notes, externalLink, expiryDate, missingnessPct, actor.id, now, ctx.project.id, artDef.id]
        );
      } else {
        await db.execute(
          `INSERT INTO project_evidence (id, project_id, artefact_id, status, notes, external_link, expiry_date, missingness_pct, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `ev-${ctx.project.id}-${artDef.id}`,
            ctx.project.id,
            artDef.id,
            nextStatus,
            notes,
            externalLink,
            expiryDate,
            missingnessPct,
            actor.id,
            now,
          ]
        );
      }

      await appendAuditLog(db, {
        userId: actor.id,
        userEmail: actor.email,
        userRole: actor.role,
        action: 'EVIDENCE_UPDATED',
        projectId: ctx.project.id,
        details: `Artefact "${artDef.name}" (${artDef.id}) changed from "${existing?.status ?? 'Not submitted'}" to "${nextStatus}".`,
        rationale: reason || (notes ? notes.slice(0, 140) : null),
        expiryDate,
        sourceIp: getClientIp(req),
        isDemo: ctx.project.is_demo,
      });

      const assessment = await runAndPersistAssessment(db, ctx.project.id, actor, getClientIp(req));
      res.json({ ok: true, assessment });
    }
  );

  app.post(
    '/api/projects/:id/evidence/:artefactId/upload',
    requireAuth,
    requireRole('PROJECT_OWNER', 'ADMIN'),
    upload.single('file'),
    async (req: AuthenticatedRequest, res: Response) => {
      const ctx = await loadProjectAssessmentContext(db, req.params.id);
      if (!ctx) return res.status(404).json({ error: 'Project not found.' });
      if (req.user!.role === 'PROJECT_OWNER' && ctx.project.owner_id !== req.user!.id) {
        return res.status(403).json({ error: 'You can only upload files to projects you own.' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file attached.' });
      }
      const artDef = ARTEFACTS.find((a) => a.id === req.params.artefactId);
      if (!artDef) return res.status(404).json({ error: 'Unknown artefact ID.' });

      const fileBuffer = fs.readFileSync(req.file.path);
      const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const now = new Date().toISOString();

      await db.execute(
        `UPDATE project_evidence
         SET file_name = ?, file_path = ?, file_size = ?, file_checksum = ?,
             status = CASE WHEN status = 'Not submitted' THEN 'Submitted' ELSE status END,
             updated_by = ?, updated_at = ?
         WHERE project_id = ? AND artefact_id = ?`,
        [
          req.file.originalname,
          req.file.filename,
          req.file.size,
          checksum,
          req.user!.id,
          now,
          ctx.project.id,
          artDef.id,
        ]
      );

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'EVIDENCE_FILE_UPLOADED',
        projectId: ctx.project.id,
        details: `Uploaded file "${req.file.originalname}" (${req.file.size} bytes, sha256=${checksum.slice(0, 12)}...) for ${artDef.id}.`,
        sourceIp: getClientIp(req),
        isDemo: ctx.project.is_demo,
      });

      const assessment = await runAndPersistAssessment(db, ctx.project.id, req.user!, getClientIp(req));
      res.json({
        fileName: req.file.originalname,
        fileSize: req.file.size,
        checksum,
        assessment,
      });
    }
  );

  app.put(
    '/api/projects/:id/fairness-check',
    requireAuth,
    requireRole('PROJECT_OWNER', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const ctx = await loadProjectAssessmentContext(db, req.params.id);
      if (!ctx) return res.status(404).json({ error: 'Project not found.' });
      if (req.user!.role === 'PROJECT_OWNER' && ctx.project.owner_id !== req.user!.id) {
        return res.status(403).json({ error: 'Owners may only update fairness metrics on their own projects.' });
      }

      const metricName =
        typeof req.body?.metric_name === 'string' && req.body.metric_name.trim()
          ? req.body.metric_name.trim()
          : 'Accuracy';
      const rawCohorts = Array.isArray(req.body?.cohorts) ? req.body.cohorts : [];
      const cohorts: CohortMetricEntry[] = rawCohorts
        .filter((c: unknown) => c && typeof c === 'object')
        .map((c: { cohort?: string; value?: unknown }) => ({
          cohort: String(c.cohort ?? '').trim(),
          metricName,
          value: Number(c.value),
        }))
        .filter((c: CohortMetricEntry) => c.cohort.length > 0 && !Number.isNaN(c.value) && c.value >= 0 && c.value <= 1);

      if (cohorts.length < 2) {
        return res.status(400).json({
          error: 'Enter valid metric values (between 0 and 1) for at least two student cohorts.',
        });
      }

      const values = cohorts.map((c) => c.value);
      const maxGap = Number((Math.max(...values) - Math.min(...values)).toFixed(4));
      const passed = maxGap <= ctx.settings.parity_tolerance;
      const now = new Date().toISOString();

      await db.execute(
        `INSERT INTO fairness_checks (project_id, metric_name, cohorts_json, max_gap, tolerance_used, passed, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           metric_name = excluded.metric_name,
           cohorts_json = excluded.cohorts_json,
           max_gap = excluded.max_gap,
           tolerance_used = excluded.tolerance_used,
           passed = excluded.passed,
           checked_at = excluded.checked_at`,
        [
          ctx.project.id,
          metricName,
          JSON.stringify(cohorts),
          maxGap,
          ctx.settings.parity_tolerance,
          db.isPostgres ? passed : passed ? 1 : 0,
          now,
        ]
      );

      // If parity failed and subgroup_error_matrix was previously Verified, downgrade to Unclear
      if (!passed) {
        await db.execute(
          `UPDATE project_evidence SET status = 'Unclear', updated_at = ?
           WHERE project_id = ? AND artefact_id = 'subgroup_error_matrix' AND status = 'Verified'`,
          [now, ctx.project.id]
        );
      }

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'FAIRNESS_CHECK_COMPUTED',
        projectId: ctx.project.id,
        details: `Computed Stage 3 parity check (${metricName}): max gap ${(maxGap * 100).toFixed(2)}% vs tolerance ${(ctx.settings.parity_tolerance * 100).toFixed(2)}% -> ${passed ? 'PASS' : 'FAIL'}.`,
        sourceIp: getClientIp(req),
        isDemo: ctx.project.is_demo,
      });

      const assessment = await runAndPersistAssessment(db, ctx.project.id, req.user!, getClientIp(req));
      res.json({
        fairnessCheck: {
          project_id: ctx.project.id,
          metric_name: metricName,
          cohorts,
          max_gap: maxGap,
          tolerance_used: ctx.settings.parity_tolerance,
          passed,
          checked_at: now,
        },
        assessment,
      });
    }
  );

  // ---- EXCEPTIONS & REVIEWER QUEUE ----
  app.post(
    '/api/projects/:id/exceptions',
    requireAuth,
    requireRole('PROJECT_OWNER', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const ctx = await loadProjectAssessmentContext(db, req.params.id);
      if (!ctx) return res.status(404).json({ error: 'Project not found.' });
      if (req.user!.role === 'PROJECT_OWNER' && ctx.project.owner_id !== req.user!.id) {
        return res.status(403).json({ error: 'You can only request exceptions on projects you own.' });
      }

      const targetType = req.body?.target_type;
      const targetId = typeof req.body?.target_id === 'string' ? req.body.target_id.trim() : '';
      const rationale = typeof req.body?.rationale === 'string' ? req.body.rationale.trim() : '';
      const expiryDate = typeof req.body?.expiry_date === 'string' ? req.body.expiry_date : '';

      if (targetType !== 'rule' && targetType !== 'artefact') {
        return res.status(400).json({ error: 'Exception target_type must be rule or artefact.' });
      }
      if (!targetId) {
        return res.status(400).json({ error: 'Specific rule ID or artefact ID is required.' });
      }
      if (rationale.length < 10) {
        return res.status(400).json({ error: 'Written rationale (at least 10 characters) is required.' });
      }
      if (!expiryDate || Number.isNaN(Date.parse(expiryDate)) || new Date(expiryDate).getTime() <= Date.now()) {
        return res.status(400).json({ error: 'A valid future expiry date is required.' });
      }

      const exId = `EX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO exceptions (id, project_id, requester_id, target_type, target_id, rationale, expiry_date, status, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`,
        [
          exId,
          ctx.project.id,
          req.user!.id,
          targetType,
          targetId,
          rationale,
          new Date(expiryDate).toISOString(),
          db.isPostgres ? ctx.project.is_demo : ctx.project.is_demo ? 1 : 0,
          now,
        ]
      );

      if (ctx.project.workflow_state === 'Draft') {
        await db.execute(`UPDATE projects SET workflow_state = 'Exception Requested', updated_at = ? WHERE id = ?`, [
          now,
          ctx.project.id,
        ]);
      }

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'EXCEPTION_REQUESTED',
        projectId: ctx.project.id,
        details: `Requested exception ${exId} for ${targetType} "${targetId}".`,
        rationale,
        expiryDate: new Date(expiryDate).toISOString(),
        sourceIp: getClientIp(req),
        isDemo: ctx.project.is_demo,
      });

      const assessment = await runAndPersistAssessment(db, ctx.project.id, req.user!, getClientIp(req));
      res.status(201).json({ id: exId, assessment });
    }
  );

  app.post(
    '/api/exceptions/:id/decide',
    requireAuth,
    requireRole('REVIEWER', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const ex = await db.get<ExceptionRecord>(`SELECT * FROM exceptions WHERE id = ?`, [req.params.id]);
      if (!ex) return res.status(404).json({ error: 'Exception not found.' });

      const ctx = await loadProjectAssessmentContext(db, ex.project_id);
      if (!ctx) return res.status(404).json({ error: 'Project not found.' });

      const actor = req.user!;
      if (ex.requester_id === actor.id) {
        return res.status(403).json({
          error: 'Separation of duties: the requester cannot approve or reject their own exception.',
        });
      }
      if (ctx.project.owner_id === actor.id) {
        return res.status(403).json({
          error: 'Separation of duties: a reviewer cannot approve or reject exceptions on a project they own.',
        });
      }
      if (ex.status !== 'Pending') {
        return res.status(400).json({ error: `Exception is already ${ex.status}.` });
      }

      const decision = req.body?.decision;
      const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
      if (decision !== 'Approved' && decision !== 'Rejected') {
        return res.status(400).json({ error: 'Decision must be Approved or Rejected.' });
      }
      if (comment.length < 5) {
        return res.status(400).json({ error: 'A reviewer comment (at least 5 characters) is required.' });
      }

      const now = new Date().toISOString();
      await db.execute(
        `UPDATE exceptions SET status = ?, reviewer_id = ?, reviewer_comment = ?, reviewed_at = ? WHERE id = ?`,
        [decision, actor.id, comment, now, ex.id]
      );

      await appendAuditLog(db, {
        userId: actor.id,
        userEmail: actor.email,
        userRole: actor.role,
        action: decision === 'Approved' ? 'EXCEPTION_APPROVED' : 'EXCEPTION_REJECTED',
        projectId: ctx.project.id,
        details: `${decision} exception ${ex.id} (${ex.target_type}: ${ex.target_id}).`,
        rationale: comment,
        expiryDate: ex.expiry_date,
        sourceIp: getClientIp(req),
        isDemo: ctx.project.is_demo,
      });

      const assessment = await runAndPersistAssessment(db, ctx.project.id, actor, getClientIp(req));
      if (
        decision === 'Approved' &&
        assessment &&
        assessment.stageSummaries.every((s) => s.effectiveGs === 1) &&
        ctx.project.workflow_state !== 'Cleared for Controlled Release'
      ) {
        await db.execute(
          `UPDATE projects SET workflow_state = 'Exception-Based Review Eligible', updated_at = ? WHERE id = ?`,
          [now, ctx.project.id]
        );
      }

      res.json({ ok: true, assessment });
    }
  );

  app.get(
    '/api/reviewer-queue',
    requireAuth,
    requireRole('REVIEWER', 'ADMIN', 'RISK_ACCEPTANCE_AUTHORITY'),
    async (_req, res: Response) => {
      await checkAndExpireApprovals(db);
      const pendingExceptions = await db.query<ExceptionRecord & { project_name: string }>(
        `SELECT e.*, p.name as project_name, u.full_name as requester_name
         FROM exceptions e
         JOIN projects p ON e.project_id = p.id
         JOIN users u ON e.requester_id = u.id
         WHERE e.status = 'Pending'
         ORDER BY e.created_at DESC`
      );

      const unclearEvidence = await db.query<{
        project_id: string;
        project_name: string;
        artefact_id: string;
        notes: string;
        updated_at: string;
      }>(
        `SELECT pe.project_id, p.name as project_name, pe.artefact_id, pe.notes, pe.updated_at
         FROM project_evidence pe
         JOIN projects p ON pe.project_id = p.id
         WHERE pe.status = 'Unclear'`
      );

      // Gather low-confidence guidance & rule conflicts from latest assessment runs
      const projects = await db.query<{ id: string; name: string }>(`SELECT id, name FROM projects`);
      const lowConfidenceItems: Array<{ project_id: string; project_name: string; ruleId: string; headline: string; score: number }> = [];
      const conflicts: Array<{ project_id: string; project_name: string; conflictId: string; resolution: string }> = [];

      for (const p of projects) {
        const latest = await db.get<{ result_json: string }>(
          `SELECT result_json FROM assessment_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
          [p.id]
        );
        if (!latest) continue;
        const parsed: AssessmentResult = JSON.parse(latest.result_json);
        for (const g of parsed.guidanceItems) {
          if (g.needsHumanInspection) {
            lowConfidenceItems.push({
              project_id: p.id,
              project_name: p.name,
              ruleId: g.ruleId,
              headline: g.plainHeadline,
              score: g.clauses[0]?.hybridScore ?? 0,
            });
          }
        }
        for (const c of parsed.conflicts) {
          conflicts.push({
            project_id: p.id,
            project_name: p.name,
            conflictId: c.id,
            resolution: c.resolution,
          });
        }
      }

      res.json({
        counts: {
          pendingExceptions: pendingExceptions.length,
          unclearArtefacts: unclearEvidence.length,
          lowConfidenceGuidance: lowConfidenceItems.length,
          ruleConflicts: conflicts.length,
          total:
            pendingExceptions.length +
            unclearEvidence.length +
            lowConfidenceItems.length +
            conflicts.length,
        },
        pendingExceptions,
        unclearEvidence,
        lowConfidenceItems,
        conflicts,
      });
    }
  );

  // ---- FORMAL RISK ACCEPTANCE (Section 15B: RISK_ACCEPTANCE_AUTHORITY ONLY) ----
  app.post(
    '/api/projects/:id/risk-acceptances',
    requireAuth,
    requireRole('RISK_ACCEPTANCE_AUTHORITY'),
    async (req: AuthenticatedRequest, res: Response) => {
      const ctx = await loadProjectAssessmentContext(db, req.params.id);
      if (!ctx) return res.status(404).json({ error: 'Project not found.' });

      const riskId = typeof req.body?.risk_id === 'string' ? req.body.risk_id.trim() : '';
      const rationale = typeof req.body?.rationale === 'string' ? req.body.rationale.trim() : '';
      const scope = typeof req.body?.scope === 'string' ? req.body.scope.trim() : '';
      const expiryDate = typeof req.body?.expiry_date === 'string' ? req.body.expiry_date : '';

      const err = validateFormalRiskAcceptance({
        riskId,
        project: ctx.project,
        actor: req.user!,
        rationale,
        scope,
        expiryDate,
        exceptions: ctx.exceptions,
      });
      if (err) {
        return res.status(err.startsWith('Forbidden') || err.startsWith('Separation') ? 403 : 400).json({ error: err });
      }

      const accId = `RA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const now = new Date().toISOString();
      const expiryIso = new Date(expiryDate).toISOString();

      await db.execute(
        `INSERT INTO risk_acceptances (id, project_id, risk_id, approver_id, rationale, scope, expiry_date, status, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
        [
          accId,
          ctx.project.id,
          riskId,
          req.user!.id,
          rationale,
          scope,
          expiryIso,
          db.isPostgres ? ctx.project.is_demo : ctx.project.is_demo ? 1 : 0,
          now,
        ]
      );

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'FORMAL_RISK_ACCEPTED',
        projectId: ctx.project.id,
        details: `Formally accepted risk ${riskId} (${accId}). Scope: ${scope}`,
        rationale,
        expiryDate: expiryIso,
        sourceIp: getClientIp(req),
        isDemo: ctx.project.is_demo,
      });

      const assessment = await runAndPersistAssessment(db, ctx.project.id, req.user!, getClientIp(req));
      res.status(201).json({ id: accId, assessment });
    }
  );

  // ---- COMMENTS & WORKFLOW STATE MACHINE ----
  app.post('/api/projects/:id/comments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const ctx = await loadProjectAssessmentContext(db, req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Project not found.' });
    if (!(await canAccessProject(req.user!, ctx.project))) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (comment.length < 3) {
      return res.status(400).json({ error: 'Review comment cannot be empty.' });
    }
    const id = `RC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO review_comments (id, project_id, author_id, comment, action_type, is_demo, created_at)
       VALUES (?, ?, ?, ?, 'COMMENT', ?, ?)`,
      [id, ctx.project.id, req.user!.id, comment, db.isPostgres ? ctx.project.is_demo : ctx.project.is_demo ? 1 : 0, now]
    );

    await appendAuditLog(db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      action: 'REVIEW_COMMENT_ADDED',
      projectId: ctx.project.id,
      details: `Added review comment: ${comment.slice(0, 120)}`,
      sourceIp: getClientIp(req),
      isDemo: ctx.project.is_demo,
    });

    res.status(201).json({ id });
  });

  app.post('/api/projects/:id/workflow', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    await checkAndExpireApprovals(db, req.params.id);
    const ctx = await loadProjectAssessmentContext(db, req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Project not found.' });
    if (!(await canAccessProject(req.user!, ctx.project))) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const targetState = req.body?.target_state as WorkflowState;
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    const assessment = await runAndPersistAssessment(db, ctx.project.id, req.user!, getClientIp(req));
    if (!assessment) return res.status(404).json({ error: 'Project not found.' });

    const check = validateWorkflowTransition({
      project: ctx.project,
      targetState,
      actor: req.user!,
      assessment,
      exceptions: ctx.exceptions,
      riskAcceptances: ctx.riskAcceptances,
    });

    if (!check.allowed) {
      return res.status(400).json({ error: check.reason });
    }

    const now = new Date().toISOString();
    await db.execute(`UPDATE projects SET workflow_state = ?, updated_at = ? WHERE id = ?`, [
      targetState,
      now,
      ctx.project.id,
    ]);

    if (comment) {
      await db.execute(
        `INSERT INTO review_comments (id, project_id, author_id, comment, action_type, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          `RC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
          ctx.project.id,
          req.user!.id,
          comment,
          targetState === 'Reviewer Sign-Off' ? 'SIGN_OFF' : 'STATE_CHANGE',
          db.isPostgres ? ctx.project.is_demo : ctx.project.is_demo ? 1 : 0,
          now,
        ]
      );
    }

    await appendAuditLog(db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      action: 'WORKFLOW_STATE_CHANGED',
      projectId: ctx.project.id,
      details: `Transitioned workflow from "${ctx.project.workflow_state}" to "${targetState}".`,
      rationale: comment || check.reason,
      sourceIp: getClientIp(req),
      isDemo: ctx.project.is_demo,
    });

    const refreshed = await runAndPersistAssessment(db, ctx.project.id, req.user!, getClientIp(req));
    res.json({ workflow_state: targetState, assessment: refreshed });
  });

  // ---- EXPORTS (JSON-LD, PDF, CSV) ----
  app.get('/api/projects/:id/jsonld', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const ctx = await loadProjectAssessmentContext(db, req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Project not found.' });
    if (!(await canAccessProject(req.user!, ctx.project))) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const latestRun = await db.get<{ result_json: string }>(
      `SELECT result_json FROM assessment_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
      [ctx.project.id]
    );
    const assessment: AssessmentResult | null = latestRun ? JSON.parse(latestRun.result_json) : null;
    await appendAuditLog(db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      action: 'JSONLD_EXPORTED',
      projectId: ctx.project.id,
      details: `Exported JSON-LD knowledge graph.`,
      sourceIp: getClientIp(req),
      isDemo: ctx.project.is_demo,
    });
    res.json(buildProjectJsonLd(ctx.project, assessment));
  });

  app.get('/api/projects/:id/report.pdf', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const ctx = await loadProjectAssessmentContext(db, req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Project not found.' });
    if (!(await canAccessProject(req.user!, ctx.project))) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const assessment = await runAndPersistAssessment(db, ctx.project.id, req.user!, getClientIp(req));
    if (!assessment) return res.status(404).json({ error: 'Assessment unavailable.' });

    const comments = (
      await db.query<ReviewCommentRecord>(
        `SELECT rc.*, u.full_name as author_name, u.role as author_role
         FROM review_comments rc JOIN users u ON rc.author_id = u.id
         WHERE rc.project_id = ? ORDER BY rc.created_at DESC`,
        [ctx.project.id]
      )
    ).map((c) => ({ ...c, is_demo: Boolean(c.is_demo) }));

    const pdfBuffer = await generateProjectReportPdf({
      project: ctx.project,
      assessment,
      exceptions: ctx.exceptions,
      riskAcceptances: ctx.riskAcceptances,
      comments,
      generatedBy: req.user!,
    });

    await appendAuditLog(db, {
      userId: req.user!.id,
      userEmail: req.user!.email,
      userRole: req.user!.role,
      action: 'PDF_REPORT_EXPORTED',
      projectId: ctx.project.id,
      details: `Generated PDF governance report for run ${assessment.runId}.`,
      sourceIp: getClientIp(req),
      isDemo: ctx.project.is_demo,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="governance-report-${ctx.project.id}.pdf"`);
    res.send(pdfBuffer);
  });

  app.get('/api/projects/:id/export.csv', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const ctx = await loadProjectAssessmentContext(db, req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Project not found.' });
    if (!(await canAccessProject(req.user!, ctx.project))) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const latestRun = await db.get<{ result_json: string }>(
      `SELECT result_json FROM assessment_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
      [ctx.project.id]
    );
    const assessment: AssessmentResult | null = latestRun ? JSON.parse(latestRun.result_json) : null;
    const rows: unknown[][] = [];
    if (assessment) {
      for (const st of assessment.stageSummaries) {
        for (const a of st.artefactDetails) {
          rows.push([
            ctx.project.name,
            st.stage,
            st.name,
            st.rs,
            st.gs,
            a.artefactId,
            a.name,
            a.isBlocking ? 'Blocking' : 'Advisory',
            a.classification,
            a.coveredByExceptionId ?? '',
          ]);
        }
      }
    }
    const csv = buildCsv(
      ['Project', 'Stage', 'Stage Name', 'Stage Rs', 'Stage Gs', 'Artefact ID', 'Artefact Name', 'Type', 'Status', 'Exception'],
      rows,
      ctx.project.is_demo
        ? 'DEMONSTRATION DATA: not real institutional approvals or governance decisions.'
        : undefined
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="project-${ctx.project.id}.csv"`);
    res.send(csv);
  });

  // ---- RULES ----
  app.get('/api/rules', requireAuth, async (_req, res: Response) => {
    const rows = await db.query<{
      id: string;
      name: string;
      type: RuleDefinition['type'];
      priority: number;
      stage: number;
      severity: RuleDefinition['severity'];
      supported_governance_req: string;
      condition_summary: string;
      action_summary: string;
      dependencies_json: string;
      enabled: number | boolean;
      updated_at: string;
    }>(`SELECT * FROM rules ORDER BY priority DESC`);
    res.json({
      rules: rows.map((r) => ({
        ...r,
        dependencies: JSON.parse(r.dependencies_json),
        enabled: Boolean(r.enabled),
      })),
    });
  });

  app.patch(
    '/api/rules/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const rule = await db.get<RuleDefinition>(`SELECT * FROM rules WHERE id = ?`, [req.params.id]);
      if (!rule) return res.status(404).json({ error: 'Rule not found.' });
      const enabled = Boolean(req.body?.enabled);
      const now = new Date().toISOString();

      await db.execute(`UPDATE rules SET enabled = ?, updated_at = ? WHERE id = ?`, [
        db.isPostgres ? enabled : enabled ? 1 : 0,
        now,
        rule.id,
      ]);

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: enabled ? 'RULE_ENABLED' : 'RULE_DISABLED',
        projectId: null,
        details: `${enabled ? 'Enabled' : 'Disabled'} ${rule.type} rule ${rule.id} (${rule.name}).`,
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });

      res.json({ ok: true, id: rule.id, enabled });
    }
  );

  // ---- POLICY LIBRARY & GROUNDED RETRIEVAL ----
  app.get('/api/policies', requireAuth, async (_req, res: Response) => {
    const rows = await db.query<{
      clause_id: string;
      source: string;
      section_number: string;
      title: string;
      text: string;
      tags_json: string;
      related_clause_ids_json: string;
      is_active: number | boolean;
      is_demo: number | boolean;
      updated_at: string;
    }>(`SELECT * FROM policy_clauses ORDER BY clause_id ASC`);
    res.json({
      corpusNotice: "Demonstration corpus: replace with your institution's real policies",
      clauses: rows.map((c) => ({
        clause_id: c.clause_id,
        source: c.source,
        section_number: c.section_number,
        title: c.title,
        text: c.text,
        tags: JSON.parse(c.tags_json),
        related_clause_ids: JSON.parse(c.related_clause_ids_json),
        is_active: Boolean(c.is_active),
        is_demo: Boolean(c.is_demo),
        updated_at: c.updated_at,
      })),
    });
  });

  app.post(
    '/api/policies',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const clauseId = typeof req.body?.clause_id === 'string' ? req.body.clause_id.trim().toUpperCase() : '';
      const source = typeof req.body?.source === 'string' ? req.body.source.trim() : '';
      const section = typeof req.body?.section_number === 'string' ? req.body.section_number.trim() : '';
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const tags = Array.isArray(req.body?.tags) ? req.body.tags : [];
      const related = Array.isArray(req.body?.related_clause_ids) ? req.body.related_clause_ids : [];

      if (!clauseId || !source || !section || !title || text.length < 10) {
        return res.status(400).json({ error: 'Clause ID, source, section, title, and text are required.' });
      }
      const exists = await db.get(`SELECT clause_id FROM policy_clauses WHERE clause_id = ?`, [clauseId]);
      if (exists) {
        return res.status(409).json({ error: `Clause ${clauseId} already exists.` });
      }
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO policy_clauses (clause_id, source, section_number, title, text, tags_json, related_clause_ids_json, is_active, is_demo, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          clauseId,
          source,
          section,
          title,
          text,
          JSON.stringify(tags),
          JSON.stringify(related),
          db.isPostgres ? true : 1,
          db.isPostgres ? false : 0,
          now,
        ]
      );

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'POLICY_CLAUSE_CREATED',
        projectId: null,
        details: `Added policy clause ${clauseId}: "${title}".`,
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });
      res.status(201).json({ clause_id: clauseId });
    }
  );

  app.put(
    '/api/policies/:clauseId',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const existing = await db.get(`SELECT * FROM policy_clauses WHERE clause_id = ?`, [req.params.clauseId]);
      if (!existing) return res.status(404).json({ error: 'Policy clause not found.' });

      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const isActive = req.body?.is_active !== undefined ? Boolean(req.body.is_active) : true;
      const tags = Array.isArray(req.body?.tags) ? req.body.tags : undefined;
      const now = new Date().toISOString();

      await db.execute(
        `UPDATE policy_clauses
         SET title = COALESCE(NULLIF(?, ''), title),
             text = COALESCE(NULLIF(?, ''), text),
             tags_json = COALESCE(?, tags_json),
             is_active = ?,
             updated_at = ?
         WHERE clause_id = ?`,
        [
          title,
          text,
          tags ? JSON.stringify(tags) : null,
          db.isPostgres ? isActive : isActive ? 1 : 0,
          now,
          req.params.clauseId,
        ]
      );

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'POLICY_CLAUSE_UPDATED',
        projectId: null,
        details: `Updated policy clause ${req.params.clauseId} (active=${isActive}).`,
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });
      res.json({ ok: true });
    }
  );

  app.post('/api/policies/search', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    const topK = Math.min(20, Math.max(1, Number(req.body?.topK || 8)));
    if (!query) {
      return res.status(400).json({ error: 'Search query is required.' });
    }
    const settings = await db.get<SystemSettings>(`SELECT * FROM settings WHERE id = 1`);
    const rows = await db.query<{
      clause_id: string;
      source: string;
      section_number: string;
      title: string;
      text: string;
      tags_json: string;
      related_clause_ids_json: string;
      is_active: number | boolean;
      is_demo: number | boolean;
    }>(`SELECT * FROM policy_clauses WHERE is_active = ?`, [db.isPostgres ? true : 1]);

    const clauses: PolicyClause[] = rows.map((c) => ({
      ...c,
      tags: JSON.parse(c.tags_json),
      related_clause_ids: JSON.parse(c.related_clause_ids_json),
      is_active: Boolean(c.is_active),
      is_demo: Boolean(c.is_demo),
    }));

    const hits = retrievePolicyClauses(query, clauses, settings ?? DEFAULT_SETTINGS, topK);
    res.json({ query, results: hits });
  });

  // ---- EVALUATION BENCHMARK ----
  app.get('/api/evaluation/cases', requireAuth, async (_req, res: Response) => {
    const rows = await db.query<{
      id: string;
      category: string;
      title: string;
      description: string;
      assumptions_json: string;
      acceptance_criteria: string;
      ground_truth_missing_json: string;
      ground_truth_gates_json: string;
      ground_truth_clauses_json: string;
      needs_two_hop: number | boolean;
      is_demo: number | boolean;
    }>(`SELECT * FROM benchmark_cases ORDER BY category, id`);
    res.json({
      note: 'Ground truth is defined independently of the system under test.',
      sampleNote: 'Small demonstration benchmark (n = 36, 12 per category). Results do not prove general real-world performance.',
      cases: rows.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        description: r.description,
        assumptions: JSON.parse(r.assumptions_json),
        acceptance_criteria: r.acceptance_criteria,
        ground_truth_missing_artefacts: JSON.parse(r.ground_truth_missing_json),
        ground_truth_gates: JSON.parse(r.ground_truth_gates_json),
        ground_truth_clause_ids: JSON.parse(r.ground_truth_clauses_json),
        needs_two_hop: Boolean(r.needs_two_hop),
        is_demo: Boolean(r.is_demo),
      })),
    });
  });

  app.get('/api/evaluation/runs', requireAuth, async (_req, res: Response) => {
    const rows = await db.query<{
      id: string;
      run_by: string;
      settings_json: string;
      summary_json: string;
      per_case_json: string;
      is_demo: number | boolean;
      created_at: string;
    }>(`SELECT * FROM evaluation_runs ORDER BY created_at DESC LIMIT 25`);

    res.json({
      runs: rows.map((r) => ({
        id: r.id,
        run_by: r.run_by,
        settings: JSON.parse(r.settings_json),
        summary: JSON.parse(r.summary_json),
        perCase: JSON.parse(r.per_case_json),
        is_demo: Boolean(r.is_demo),
        created_at: r.created_at,
      })),
    });
  });

  app.post(
    '/api/evaluation/run',
    requireAuth,
    requireRole('REVIEWER', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const out = await runBenchmarkEvaluation(db, req.user!.id);
      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'EVALUATION_RUN',
        projectId: null,
        details: `Executed 36-case benchmark (${out.summary.runId}): Gate F1 ${(out.summary.governanceSystem.gateF1 * 100).toFixed(1)}% vs baseline ${(out.summary.baselineSystem.gateF1 * 100).toFixed(1)}%.`,
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });
      res.json(out);
    }
  );

  app.get('/api/evaluation/runs/:id/export.csv', requireAuth, async (req, res) => {
    const row = await db.get<{ summary_json: string; per_case_json: string }>(
      `SELECT summary_json, per_case_json FROM evaluation_runs WHERE id = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Evaluation run not found.' });
    const perCase = JSON.parse(row.per_case_json) as Array<{
      id: string;
      category: string;
      title: string;
      govMissingCount: number;
      truthMissingCount: number;
      govGates: string[];
      baseGates: string[];
      truthGates: string[];
      govLatencyMs: number;
      baseLatencyMs: number;
    }>;
    const csv = buildCsv(
      ['Case ID', 'Category', 'Title', 'Gov Missing Count', 'Truth Missing Count', 'Gov Gates', 'Baseline Gates', 'Truth Gates', 'Gov Latency (ms)', 'Baseline Latency (ms)'],
      perCase.map((c) => [
        c.id,
        c.category,
        c.title,
        c.govMissingCount,
        c.truthMissingCount,
        c.govGates.join('; '),
        c.baseGates.join('; '),
        c.truthGates.join('; '),
        c.govLatencyMs,
        c.baseLatencyMs,
      ]),
      'DEMONSTRATION DATA (n = 36): Small demonstration benchmark. Results do not prove general real-world performance.'
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="evaluation-${req.params.id}.csv"`);
    res.send(csv);
  });

  // ---- AUDIT LOG ----
  app.get('/api/audit', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
    const includeDemo =
      req.query.includeDemo === 'true'
        ? true
        : req.query.includeDemo === 'false'
        ? false
        : Boolean(req.user!.is_demo);

    let rows = await db.query<AuditEntry>(`SELECT * FROM audit_logs ORDER BY seq_num DESC LIMIT 300`);
    const hiddenDemoCount = includeDemo ? 0 : rows.filter((r) => Boolean(r.is_demo)).length;
    if (!includeDemo) {
      rows = rows.filter((r) => !Boolean(r.is_demo));
    }
    if (req.user!.role === 'PROJECT_OWNER') {
      const ownProjs = await db.query<{ id: string }>(`SELECT id FROM projects WHERE owner_id = ?`, [
        req.user!.id,
      ]);
      const ownSet = new Set(ownProjs.map((p) => p.id));
      rows = rows.filter((r) => !r.project_id || ownSet.has(r.project_id) || r.user_id === req.user!.id);
    }
    if (action) rows = rows.filter((r) => r.action === action);
    if (projectId) rows = rows.filter((r) => r.project_id === projectId);
    if (search) {
      rows = rows.filter(
        (r) =>
          r.details.toLowerCase().includes(search) ||
          r.action.toLowerCase().includes(search) ||
          (r.user_email ?? '').toLowerCase().includes(search) ||
          (r.source_ip ?? '').toLowerCase().includes(search)
      );
    }
    res.json({
      entries: rows.map((r) => ({ ...r, is_demo: Boolean(r.is_demo) })),
      hiddenDemoCount,
      includeDemo,
      postgresNote:
        'Hash-chained and append-only at the application and database-permission level (PostgreSQL deployments). A database administrator with full privileges could still alter the database; chain verification would detect that.',
    });
  });

  app.post(
    '/api/audit/verify',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const verification = await verifyAuditChain(db);
      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'AUDIT_CHAIN_VERIFIED',
        projectId: null,
        details: verification.valid
          ? `Verified ${verification.totalEntries} audit entries: SHA-256 chain intact.`
          : `Audit chain check FAILED at seq ${verification.brokenAtSeq}: ${verification.reason}`,
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });
      res.json(verification);
    }
  );

  app.get('/api/audit/export.csv', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const includeDemo =
      req.query.includeDemo === 'true'
        ? true
        : req.query.includeDemo === 'false'
        ? false
        : Boolean(req.user!.is_demo);
    let rows = await db.query<AuditEntry>(`SELECT * FROM audit_logs ORDER BY seq_num ASC`);
    if (!includeDemo) {
      rows = rows.filter((r) => !Boolean(r.is_demo));
    }
    const containsDemo = rows.some((r) => Boolean(r.is_demo));
    const csv = buildCsv(
      ['Seq', 'Timestamp', 'User Email', 'Role', 'Action', 'Project ID', 'Details', 'Rationale', 'Expiry', 'Source IP', 'Prev Hash', 'Entry Hash', 'Record Type'],
      rows.map((r) => [
        r.seq_num,
        r.created_at,
        r.user_email,
        r.user_role,
        r.action,
        r.project_id,
        r.details,
        r.rationale,
        r.expiry_date,
        r.source_ip,
        r.prev_hash,
        r.entry_hash,
        r.is_demo ? 'DEMO' : 'LIVE',
      ]),
      containsDemo
        ? 'DEMONSTRATION DATA: Audit export includes historical demonstration records.'
        : undefined
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.send(csv);
  });

  // ---- SETTINGS ----
  app.get('/api/settings', requireAuth, async (_req, res: Response) => {
    const settings = await db.get<SystemSettings>(`SELECT * FROM settings WHERE id = 1`);
    res.json({ settings: settings ?? DEFAULT_SETTINGS, defaults: DEFAULT_SETTINGS });
  });

  app.put(
    '/api/settings',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const next: SystemSettings = {
        missingness_threshold: Number(req.body?.missingness_threshold),
        parity_tolerance: Number(req.body?.parity_tolerance),
        readiness_threshold: Number(req.body?.readiness_threshold),
        retrieval_high_threshold: Number(req.body?.retrieval_high_threshold),
        retrieval_medium_threshold: Number(req.body?.retrieval_medium_threshold),
        hybrid_weight: Number(req.body?.hybrid_weight),
        bm25_k1: Number(req.body?.bm25_k1),
        bm25_b: Number(req.body?.bm25_b),
      };

      for (const [k, v] of Object.entries(next)) {
        if (Number.isNaN(v)) {
          return res.status(400).json({ error: `Setting "${k}" must be a valid number.` });
        }
      }
      if (next.retrieval_medium_threshold > next.retrieval_high_threshold) {
        return res.status(400).json({
          error: 'Medium retrieval threshold cannot exceed High retrieval threshold.',
        });
      }
      if (next.hybrid_weight < 0 || next.hybrid_weight > 1) {
        return res.status(400).json({ error: 'Hybrid weight must be between 0 and 1.' });
      }
      if (next.bm25_b < 0 || next.bm25_b > 1) {
        return res.status(400).json({ error: 'BM25 b must be between 0 and 1.' });
      }

      const now = new Date().toISOString();
      await db.execute(
        `UPDATE settings SET
          missingness_threshold = ?, parity_tolerance = ?, readiness_threshold = ?,
          retrieval_high_threshold = ?, retrieval_medium_threshold = ?,
          hybrid_weight = ?, bm25_k1 = ?, bm25_b = ?, updated_at = ?
         WHERE id = 1`,
        [
          next.missingness_threshold,
          next.parity_tolerance,
          next.readiness_threshold,
          next.retrieval_high_threshold,
          next.retrieval_medium_threshold,
          next.hybrid_weight,
          next.bm25_k1,
          next.bm25_b,
          now,
        ]
      );

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'SETTINGS_UPDATED',
        projectId: null,
        details: `Updated governance settings: ${JSON.stringify(next)}`,
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });

      // Re-run checks across all projects
      const projects = await db.query<{ id: string }>(`SELECT id FROM projects`);
      for (const p of projects) {
        await runAndPersistAssessment(db, p.id, req.user!, getClientIp(req));
      }

      res.json({ settings: { ...next, updated_at: now } });
    }
  );

  app.post(
    '/api/settings/reset',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const now = new Date().toISOString();
      await db.execute(
        `UPDATE settings SET
          missingness_threshold = ?, parity_tolerance = ?, readiness_threshold = ?,
          retrieval_high_threshold = ?, retrieval_medium_threshold = ?,
          hybrid_weight = ?, bm25_k1 = ?, bm25_b = ?, updated_at = ?
         WHERE id = 1`,
        [
          DEFAULT_SETTINGS.missingness_threshold,
          DEFAULT_SETTINGS.parity_tolerance,
          DEFAULT_SETTINGS.readiness_threshold,
          DEFAULT_SETTINGS.retrieval_high_threshold,
          DEFAULT_SETTINGS.retrieval_medium_threshold,
          DEFAULT_SETTINGS.hybrid_weight,
          DEFAULT_SETTINGS.bm25_k1,
          DEFAULT_SETTINGS.bm25_b,
          now,
        ]
      );

      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'SETTINGS_RESET',
        projectId: null,
        details: 'Restored default system governance thresholds and retrieval parameters.',
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });

      const projects = await db.query<{ id: string }>(`SELECT id FROM projects`);
      for (const p of projects) {
        await runAndPersistAssessment(db, p.id, req.user!, getClientIp(req));
      }

      res.json({ settings: { ...DEFAULT_SETTINGS, updated_at: now } });
    }
  );

  // ---- ACTIVATE REAL PRODUCTION WORKSPACE ----
  app.post(
    '/api/admin/activate-real-workspace',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const removeDemoData = req.body?.removeDemoData !== false;
      const promoteBaselinePolicies = req.body?.promoteBaselinePolicies !== false;

      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Please enter a valid email address (for example, your Gmail).' });
      }
      if (fullName.length < 2) {
        return res.status(400).json({ error: 'Full name is required.' });
      }
      if (password && password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      }

      const now = new Date().toISOString();
      let targetUser: UserRecord | null = null;
      let removedDemoProjects = 0;
      let removedDemoUsers = 0;

      const existing = await db.get<UserRecord & { password_hash: string }>(
        `SELECT * FROM users WHERE LOWER(email) = ?`,
        [email]
      );
      if (!existing && password.length < 8) {
        return res.status(400).json({
          error: 'Please choose a password (at least 8 characters) for your real admin account.',
        });
      }

      await db.withTransaction(async (tx) => {
        if (existing) {
          const nextHash = password ? hashPassword(password) : existing.password_hash;
          await tx.execute(
            `UPDATE users
             SET email = ?, full_name = ?, password_hash = ?, role = 'ADMIN',
                 is_active = ?, force_password_change = ?, is_demo = ?
             WHERE id = ?`,
            [
              email,
              fullName,
              nextHash,
              tx.isPostgres ? true : 1,
              tx.isPostgres ? false : 0,
              tx.isPostgres ? false : 0,
              existing.id,
            ]
          );
          targetUser = {
            id: existing.id,
            email,
            full_name: fullName,
            role: 'ADMIN',
            is_active: true,
            force_password_change: false,
            is_demo: false,
            created_at: existing.created_at,
          };
        } else {
          const newId = `user-${crypto.randomBytes(5).toString('hex')}`;
          await tx.execute(
            `INSERT INTO users (id, email, full_name, password_hash, role, is_active, force_password_change, is_demo, created_at)
             VALUES (?, ?, ?, ?, 'ADMIN', ?, ?, ?, ?)`,
            [
              newId,
              email,
              fullName,
              hashPassword(password),
              tx.isPostgres ? true : 1,
              tx.isPostgres ? false : 0,
              tx.isPostgres ? false : 0,
              now,
            ]
          );
          targetUser = {
            id: newId,
            email,
            full_name: fullName,
            role: 'ADMIN',
            is_active: true,
            force_password_change: false,
            is_demo: false,
            created_at: now,
          };
        }

        if (promoteBaselinePolicies) {
          await tx.execute(`UPDATE policy_clauses SET is_demo = ? WHERE is_demo = ?`, [
            tx.isPostgres ? false : 0,
            tx.isPostgres ? true : 1,
          ]);
        }

        if (removeDemoData) {
          const delProj = await tx.execute(`DELETE FROM projects WHERE is_demo = ?`, [
            tx.isPostgres ? true : 1,
          ]);
          removedDemoProjects = delProj.changes;

          await tx.execute(`DELETE FROM evaluation_runs WHERE is_demo = ?`, [
            tx.isPostgres ? true : 1,
          ]);

          await tx.execute(
            `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE is_demo = ?)`,
            [tx.isPostgres ? true : 1]
          );

          const demoUsers = await tx.query<{ id: string }>(
            `SELECT id FROM users WHERE is_demo = ? AND id != ?`,
            [tx.isPostgres ? true : 1, targetUser!.id]
          );
          for (const du of demoUsers) {
            const refProj = await tx.get<{ cnt: number }>(
              `SELECT COUNT(*) as cnt FROM projects WHERE owner_id = ? OR assigned_reviewer_id = ?`,
              [du.id, du.id]
            );
            const refEx = await tx.get<{ cnt: number }>(
              `SELECT COUNT(*) as cnt FROM exceptions WHERE requester_id = ? OR reviewer_id = ?`,
              [du.id, du.id]
            );
            const refRa = await tx.get<{ cnt: number }>(
              `SELECT COUNT(*) as cnt FROM risk_acceptances WHERE approver_id = ?`,
              [du.id]
            );
            const refRc = await tx.get<{ cnt: number }>(
              `SELECT COUNT(*) as cnt FROM review_comments WHERE author_id = ?`,
              [du.id]
            );
            const totalRefs =
              Number(refProj?.cnt ?? 0) +
              Number(refEx?.cnt ?? 0) +
              Number(refRa?.cnt ?? 0) +
              Number(refRc?.cnt ?? 0);

            if (totalRefs === 0) {
              await tx.execute(`DELETE FROM users WHERE id = ?`, [du.id]);
              removedDemoUsers += 1;
            } else {
              await tx.execute(`UPDATE users SET is_active = ? WHERE id = ?`, [
                tx.isPostgres ? false : 0,
                du.id,
              ]);
            }
          }
        }
      });

      const session = await createSession(db, targetUser!.id, config, req);
      setSessionCookie(res, req, session.sessionId, config);

      await appendAuditLog(db, {
        userId: targetUser!.id,
        userEmail: targetUser!.email,
        userRole: targetUser!.role,
        action: 'REAL_WORKSPACE_ACTIVATED',
        projectId: null,
        details: `Activated real governance workspace for ${targetUser!.email}. Removed ${removedDemoProjects} demo projects and ${removedDemoUsers} demo accounts.`,
        sourceIp: getClientIp(req),
        isDemo: false,
      });

      res.json({
        user: targetUser,
        csrfToken: session.csrfToken,
        sessionToken: session.sessionId,
        expiresAt: session.expiresAt,
        removedDemoProjects,
        removedDemoUsers,
      });
    }
  );

  // ---- ADMIN SITE ACTIVITY, ACTIVE SESSIONS & ACCESS REQUESTS ----
  app.get(
    '/api/admin/activity',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const nowIso = new Date().toISOString();
      const since24h = new Date(Date.now() - 86400 * 1000).toISOString();

      const visits = await db.query<{
        id: string;
        visited_at: string;
        ip_address: string;
        user_agent: string;
        path: string;
        referrer: string | null;
        user_id: string | null;
        user_email: string | null;
      }>(`SELECT * FROM site_visits ORDER BY visited_at DESC LIMIT 100`);

      const totalVisitsRow = await db.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM site_visits`);
      const uniqueIpsRow = await db.get<{ cnt: number }>(
        `SELECT COUNT(DISTINCT ip_address) as cnt FROM site_visits WHERE visited_at >= ?`,
        [since24h]
      );

      const activeSessionsRaw = await db.query<{
        id: string;
        user_id: string;
        expires_at: string;
        created_at: string;
        email: string;
        full_name: string;
        role: UserRole;
        ip_address: string | null;
        user_agent: string | null;
        last_seen_at: string | null;
      }>(
        `SELECT s.id, s.user_id, s.expires_at, s.created_at,
                u.email, u.full_name, u.role,
                sa.ip_address, sa.user_agent, sa.last_seen_at
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         LEFT JOIN session_activity sa ON sa.session_id = s.id
         WHERE s.expires_at > ?
         ORDER BY COALESCE(sa.last_seen_at, s.created_at) DESC`,
        [nowIso]
      );

      const accessRequests = await db.query<{
        id: string;
        email: string;
        full_name: string;
        requested_role: UserRole;
        reason: string;
        status: string;
        source_ip: string | null;
        reviewed_by: string | null;
        reviewed_at: string | null;
        created_at: string;
      }>(
        `SELECT id, email, full_name, requested_role, reason, status, source_ip, reviewed_by, reviewed_at, created_at
         FROM access_requests
         ORDER BY CASE WHEN status = 'Pending' THEN 0 ELSE 1 END, created_at DESC
         LIMIT 100`
      );

      const pendingCount = accessRequests.filter((r) => r.status === 'Pending').length;

      res.json({
        stats: {
          totalVisits: Number(totalVisitsRow?.cnt ?? 0),
          uniqueIps24h: Number(uniqueIpsRow?.cnt ?? 0),
          activeSessionCount: activeSessionsRaw.length,
          pendingAccessRequests: pendingCount,
        },
        visits,
        activeSessions: activeSessionsRaw.map((s) => ({
          id: s.id,
          user_id: s.user_id,
          email: s.email,
          full_name: s.full_name,
          role: s.role,
          ip_address: s.ip_address ?? 'Unknown',
          user_agent: s.user_agent ?? 'Unknown',
          created_at: s.created_at,
          last_seen_at: s.last_seen_at ?? s.created_at,
          expires_at: s.expires_at,
          isCurrentSession: s.id === req.sessionId,
        })),
        accessRequests,
      });
    }
  );

  app.post(
    '/api/admin/access-requests/:id/decide',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const decision = req.body?.decision;
      const assignedRole = req.body?.assignedRole as UserRole | undefined;
      if (!['Approved', 'Rejected'].includes(decision)) {
        return res.status(400).json({ error: 'Decision must be Approved or Rejected.' });
      }

      const ar = await db.get<{
        id: string;
        email: string;
        full_name: string;
        password_hash: string;
        requested_role: UserRole;
        status: string;
      }>(`SELECT * FROM access_requests WHERE id = ?`, [req.params.id]);
      if (!ar) return res.status(404).json({ error: 'Access request not found.' });
      if (ar.status !== 'Pending') {
        return res.status(400).json({ error: 'This access request has already been processed.' });
      }

      const finalRole =
        assignedRole &&
        ['PROJECT_OWNER', 'REVIEWER', 'ADMIN', 'RISK_ACCEPTANCE_AUTHORITY'].includes(assignedRole)
          ? assignedRole
          : ar.requested_role;
      const now = new Date().toISOString();

      if (decision === 'Approved') {
        const exists = await db.get(`SELECT id FROM users WHERE LOWER(email) = ?`, [
          ar.email.toLowerCase(),
        ]);
        if (exists) {
          return res.status(409).json({ error: 'A user with this email already exists.' });
        }

        const newUserId = `user-${crypto.randomBytes(5).toString('hex')}`;
        await db.withTransaction(async (tx) => {
          await tx.execute(
            `INSERT INTO users (id, email, full_name, password_hash, role, is_active, force_password_change, is_demo, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newUserId,
              ar.email.toLowerCase(),
              ar.full_name,
              ar.password_hash,
              finalRole,
              tx.isPostgres ? true : 1,
              tx.isPostgres ? false : 0,
              tx.isPostgres ? false : 0,
              now,
            ]
          );
          await tx.execute(
            `UPDATE access_requests SET status = 'Approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
            [req.user!.id, now, ar.id]
          );
        });

        await appendAuditLog(db, {
          userId: req.user!.id,
          userEmail: req.user!.email,
          userRole: req.user!.role,
          action: 'ACCESS_REQUEST_APPROVED',
          projectId: null,
          details: `Approved access request for ${ar.email} (${ar.full_name}) with role ${finalRole}.`,
          sourceIp: getClientIp(req),
          isDemo: req.user!.is_demo,
        });
      } else {
        await db.execute(
          `UPDATE access_requests SET status = 'Rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
          [req.user!.id, now, ar.id]
        );
        await appendAuditLog(db, {
          userId: req.user!.id,
          userEmail: req.user!.email,
          userRole: req.user!.role,
          action: 'ACCESS_REQUEST_REJECTED',
          projectId: null,
          details: `Rejected access request for ${ar.email} (${ar.full_name}).`,
          sourceIp: getClientIp(req),
          isDemo: req.user!.is_demo,
        });
      }

      res.json({ ok: true, status: decision });
    }
  );

  app.delete(
    '/api/admin/sessions/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const targetSid = req.params.id;
      const existing = await db.get<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM sessions WHERE id = ?`,
        [targetSid]
      );
      if (!existing) return res.status(404).json({ error: 'Session not found.' });
      await db.execute(`DELETE FROM sessions WHERE id = ?`, [targetSid]);
      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'SESSION_REVOKED',
        projectId: null,
        details: `Administrator revoked session for user ${existing.user_id}.`,
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });
      res.json({ ok: true });
    }
  );

  // ---- ADMIN SELF-TESTS ----
  app.post(
    '/api/admin/self-tests',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      const report = await runSelfTestSuite();
      await appendAuditLog(db, {
        userId: req.user!.id,
        userEmail: req.user!.email,
        userRole: req.user!.role,
        action: 'SELF_TESTS_RUN',
        projectId: null,
        details: `Self-tests completed: ${report.passed}/${report.total} passed.`,
        sourceIp: getClientIp(req),
        isDemo: req.user!.is_demo,
      });
      res.json(report);
    }
  );

  // Friendly error handler (no raw stack traces leaked to client)
  app.use((err: Error, _req: express.Request, res: Response, _next: express.NextFunction) => {
    console.error('Unhandled server error:', err.message);
    if (err.message.includes('Unsupported file type') || err.message.includes('File too large')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'An unexpected server error occurred. Please check your inputs or try again.' });
  });

  return app;
}
