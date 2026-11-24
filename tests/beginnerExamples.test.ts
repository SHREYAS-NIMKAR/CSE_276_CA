import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { createDatabase } from '../server/db';
import { seedDatabase } from '../server/seed';
import { BEGINNER_EXAMPLES, PARAMETER_GUIDE } from '../src/data/beginnerExamples';

async function startCleanServer() {
  const db = await createDatabase(':memory:');
  await seedDatabase(db, { seedDemoData: false });
  const config = loadConfig();
  const app = createApp(db, config);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    db,
    baseUrl,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
      await db.close();
    },
  };
}

test('Beginner example catalog and parameter cheat sheet are complete and distinct', () => {
  assert.equal(BEGINNER_EXAMPLES.length, 3);
  const keys = new Set(BEGINNER_EXAMPLES.map((ex) => ex.key));
  assert.deepEqual([...keys].sort(), ['exception', 'needs_fixes', 'ready']);

  for (const ex of BEGINNER_EXAMPLES) {
    assert.ok(ex.projectName.length > 5);
    assert.ok(ex.prefill.name.length > 3);
    assert.ok(ex.prefill.description.length > 10);
    assert.ok(ex.whatYouLearn.length > 10);
  }

  assert.ok(PARAMETER_GUIDE.length >= 6);
  for (const row of PARAMETER_GUIDE) {
    assert.ok(row.parameter && row.limit && row.plainMeaning && row.whereToTest);
  }
});

test('POST /api/projects/load-samples loads 3 demo practice projects in a clean production workspace idempotently', async () => {
  const srv = await startCleanServer();
  try {
    // 1. Bootstrap a real workspace admin (no demo users or demo projects yet)
    const bootRes = await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@clean-site.edu',
        full_name: 'Workspace Admin',
        password: 'CleanAdmin!2026',
      }),
    });
    assert.equal(bootRes.status, 201);
    const cookie = (bootRes.headers.get('set-cookie') || '').split(';')[0];
    const bootJson = (await bootRes.json()) as { csrfToken: string };

    // Confirm workspace initially has 0 projects
    const initialProjRes = await fetch(`${srv.baseUrl}/api/projects`, {
      headers: { Cookie: cookie },
    });
    const initialProjJson = (await initialProjRes.json()) as { projects: unknown[] };
    assert.equal(initialProjJson.projects.length, 0);

    // 2. Reject invalid example key
    const invalidRes = await fetch(`${srv.baseUrl}/api/projects/load-samples`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'x-csrf-token': bootJson.csrfToken,
      },
      body: JSON.stringify({ key: 'unknown_template' }),
    });
    assert.equal(invalidRes.status, 400);

    // 3. Load all 3 beginner demo projects
    const loadRes = await fetch(`${srv.baseUrl}/api/projects/load-samples`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'x-csrf-token': bootJson.csrfToken,
      },
      body: JSON.stringify({ key: 'all' }),
    });
    assert.equal(loadRes.status, 201);
    const loadJson = (await loadRes.json()) as {
      createdCount: number;
      projectIds: string[];
      primaryProjectId: string;
    };
    assert.equal(loadJson.createdCount, 3);
    assert.equal(loadJson.projectIds.length, 3);
    assert.ok(loadJson.primaryProjectId);

    // Verify loaded projects have expected assessment outcomes & DEMO tag
    const listRes = await fetch(`${srv.baseUrl}/api/projects`, {
      headers: { Cookie: cookie },
    });
    const listJson = (await listRes.json()) as {
      projects: Array<{
        id: string;
        name: string;
        is_demo: boolean;
        latestAssessment: {
          overallReadiness: number;
          releaseLocked: boolean;
        };
      }>;
    };
    assert.equal(listJson.projects.length, 3);
    assert.ok(listJson.projects.every((p) => p.is_demo === true));

    const readyProj = listJson.projects.find((p) => p.name.includes('Study Planner'));
    const fixProj = listJson.projects.find((p) => p.name.includes('Scholarship Essay Screener'));
    assert.ok(readyProj);
    assert.ok(fixProj);
    assert.equal(readyProj.latestAssessment.overallReadiness, 1);
    assert.equal(readyProj.latestAssessment.releaseLocked, false);
    assert.equal(fixProj.latestAssessment.releaseLocked, true);

    // Check detailed evidence & fairness on the needs-fixes sample
    const fixDetailRes = await fetch(`${srv.baseUrl}/api/projects/${fixProj.id}`, {
      headers: { Cookie: cookie },
    });
    const fixDetail = (await fixDetailRes.json()) as {
      evidence: Array<{ artefact_id: string; missingness_pct: number | null }>;
      fairnessCheck: { max_gap: number; passed: boolean } | null;
    };
    const schema = fixDetail.evidence.find((e) => e.artefact_id === 'schema_profile');
    assert.equal(schema?.missingness_pct, 0.092);
    assert.equal(fixDetail.fairnessCheck?.max_gap, 0.11);
    assert.equal(fixDetail.fairnessCheck?.passed, false);

    // 4. Calling load-samples again is idempotent (creates 0 duplicates)
    const repeatRes = await fetch(`${srv.baseUrl}/api/projects/load-samples`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'x-csrf-token': bootJson.csrfToken,
      },
      body: JSON.stringify({ key: 'needs_fixes' }),
    });
    assert.equal(repeatRes.status, 201);
    const repeatJson = (await repeatRes.json()) as {
      createdCount: number;
      primaryProjectId: string;
    };
    assert.equal(repeatJson.createdCount, 0);
    assert.equal(repeatJson.primaryProjectId, fixProj.id);
  } finally {
    await srv.close();
  }
});
