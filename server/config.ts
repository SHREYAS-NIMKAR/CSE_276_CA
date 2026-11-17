import crypto from 'crypto';
import path from 'path';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  isPostgres: boolean;
  seedDemoData: boolean;
  sessionSecret: string;
  sessionLifetimeSeconds: number;
  allowedOrigins: string[];
  uploadDir: string;
  maxUploadBytes: number;
  loginMaxFailures: number;
  loginLockoutSeconds: number;
}

let ephemeralSecret: string | null = null;

function getSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret !== 'change-me-to-a-long-random-secret-in-production') {
    return envSecret;
  }
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString('hex');
  }
  return ephemeralSecret;
}

export function loadConfig(): AppConfig {
  const envPort = process.env.PORT?.trim();
  const nginxPort = process.env.NGINX_PORT?.trim();
  const defaultAppPort = process.env.DEFAULT_APP_PORT?.trim();
  const port = Number(envPort && envPort !== nginxPort ? envPort : defaultAppPort || 3000);
  const databaseUrl = process.env.DATABASE_URL?.trim() || 'sqlite:./data/governance.db';
  const isPostgres = databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://');
  const seedDemoRaw = process.env.SEED_DEMO_DATA?.trim().toLowerCase();
  const seedDemoData = seedDemoRaw !== 'false' && seedDemoRaw !== '0';
  const sessionLifetimeSeconds = Math.max(300, Number(process.env.SESSION_LIFETIME_SECONDS || 28800));
  const rawOrigins = process.env.ALLOWED_ORIGINS?.trim() || '';
  const allowedOrigins = rawOrigins
    ? rawOrigins.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const uploadDir = path.resolve(process.env.UPLOAD_DIR?.trim() || './uploads');

  return {
    port,
    databaseUrl,
    isPostgres,
    seedDemoData,
    sessionSecret: getSessionSecret(),
    sessionLifetimeSeconds,
    allowedOrigins,
    uploadDir,
    maxUploadBytes: 5 * 1024 * 1024,
    loginMaxFailures: 5,
    loginLockoutSeconds: 120,
  };
}
