import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app';
import { loadConfig } from './server/config';
import { createDatabase } from './server/db';
import { seedDatabase } from './server/seed';
import { checkAndExpireApprovals } from './server/workflow';

async function bootstrap() {
  const config = loadConfig();
  const db = await createDatabase(config.databaseUrl);
  await seedDatabase(db);

  const app = createApp(db, config);

  // Periodic background expiry check for exceptions and formal risk acceptances (every 60s)
  const expiryInterval = setInterval(() => {
    checkAndExpireApprovals(db).catch((err) =>
      console.error('Scheduled expiry check failed:', err)
    );
  }, 60_000);
  expiryInterval.unref();

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(
      `AI Governance Assistant running on http://0.0.0.0:${config.port} (${config.isPostgres ? 'PostgreSQL' : 'SQLite'})`
    );
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
