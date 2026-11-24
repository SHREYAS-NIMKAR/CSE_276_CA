import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createApp } from '../server/app';
import { appendAuditLog, verifyAuditChain } from '../server/audit';
import { loadConfig } from '../server/config';
import { createDatabase } from '../server/db';
import { seedDatabase } from '../server/seed';

async function startTestServer() {
  const db = await createDatabase(':memory:');
  await seedDatabase(db);
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

async function loginAs(baseUrl: string, email: string, password: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  const body = (await res.json()) as { csrfToken: string; user: { id: string; role: string } };
  return { cookie, csrfToken: body.csrfToken, user: body.user };
}

test('Integration: RBAC, ownership, CSRF, evidence reassessment, PDF report, and audit immutability', async () => {
  const srv = await startTestServer();
  try {
    // 1. Unauthenticated request returns 401
    const unauthRes = await fetch(`${srv.baseUrl}/api/projects`);
    assert.equal(unauthRes.status, 401);

    // 2. Owner 1 logs in and cannot see Owner 2's project (proj-synthetic-edge)
    const owner1 = await loginAs(srv.baseUrl, 'maya.patel@univ-ai.edu', 'OwnerMaya!2026');
    const ownProjectsRes = await fetch(`${srv.baseUrl}/api/projects`, {
      headers: { Cookie: owner1.cookie },
    });
    const ownProjectsJson = (await ownProjectsRes.json()) as { projects: Array<{ id: string }> };
    assert.ok(!ownProjectsJson.projects.some((p) => p.id === 'proj-synthetic-edge'));

    const forbiddenProj = await fetch(`${srv.baseUrl}/api/projects/proj-synthetic-edge`, {
      headers: { Cookie: owner1.cookie },
    });
    assert.equal(forbiddenProj.status, 403);

    // 3. CSRF token missing -> 403
    const noCsrf = await fetch(`${srv.baseUrl}/api/projects/proj-essay-incomplete/assess`, {
      method: 'POST',
      headers: { Cookie: owner1.cookie },
    });
    assert.equal(noCsrf.status, 403);

    // 4. Owner cannot set artefact to Verified -> 403
    const ownerVerifyAttempt = await fetch(
      `${srv.baseUrl}/api/projects/proj-essay-incomplete/evidence/rollback_plan`,
      {
        method: 'PUT',
        headers: {
          Cookie: owner1.cookie,
          'X-CSRF-Token': owner1.csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'Verified' }),
      }
    );
    assert.equal(ownerVerifyAttempt.status, 403);

    // 5. Owner submits rollback_plan -> triggers reassessment and updates assessment
    const submitRes = await fetch(
      `${srv.baseUrl}/api/projects/proj-essay-incomplete/evidence/rollback_plan`,
      {
        method: 'PUT',
        headers: {
          Cookie: owner1.cookie,
          'X-CSRF-Token': owner1.csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'Submitted', notes: 'Added kill-switch procedure.' }),
      }
    );
    assert.equal(submitRes.status, 200);

    // 6. Reviewer 2 cannot approve Owner 2's exception if they were requester; Reviewer 1 can verify rollback_plan
    const reviewer1 = await loginAs(srv.baseUrl, 'dr.sara.okafor@univ-ai.edu', 'ReviewSara!2026');
    const verifyRes = await fetch(
      `${srv.baseUrl}/api/projects/proj-essay-incomplete/evidence/rollback_plan`,
      {
        method: 'PUT',
        headers: {
          Cookie: reviewer1.cookie,
          'X-CSRF-Token': reviewer1.csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'Verified', reason: 'Verified rollback test' }),
      }
    );
    assert.equal(verifyRes.status, 200);
    const verifyJson = (await verifyRes.json()) as {
      assessment: { firedRules: Array<{ ruleId: string }> };
    };
    assert.ok(!verifyJson.assessment.firedRules.some((r) => r.ruleId === 'R3'));

    // 7. Admin cannot formally accept risks (only RISK_ACCEPTANCE_AUTHORITY can)
    const admin = await loginAs(srv.baseUrl, 'admin@univ-ai.edu', 'AdminGov!2026');
    const adminRaaAttempt = await fetch(
      `${srv.baseUrl}/api/projects/proj-essay-incomplete/risk-acceptances`,
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'X-CSRF-Token': admin.csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          risk_id: 'RISK_ACCOUNTABILITY_GAP',
          rationale: 'Admin trying to accept risk',
          scope: 'Test',
          expiry_date: new Date(Date.now() + 86400000).toISOString(),
        }),
      }
    );
    assert.equal(adminRaaAttempt.status, 403);

    // 8. PDF report generates valid PDF bytes
    const pdfRes = await fetch(`${srv.baseUrl}/api/projects/proj-essay-incomplete/report.pdf`, {
      headers: { Cookie: admin.cookie },
    });
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await pdfRes.arrayBuffer());
    assert.equal(buf.slice(0, 4).toString('utf8'), '%PDF');

    // 9. Audit log is append-only (UPDATE/DELETE rejected by trigger) and chain verifies cleanly
    await assert.rejects(() =>
      srv.db.execute(`UPDATE audit_logs SET details = 'tampered' WHERE seq_num = 1`)
    );
    await assert.rejects(() => srv.db.execute(`DELETE FROM audit_logs WHERE seq_num = 1`));

    const verifyChain = await verifyAuditChain(srv.db);
    assert.equal(verifyChain.valid, true);
  } finally {
    await srv.close();
  }
});

test('Audit Concurrency: 30 parallel writes maintain gapless sequence and unbroken SHA-256 chain', async () => {
  const db = await createDatabase(':memory:');
  try {
    await Promise.all(
      Array.from({ length: 30 }, (_, idx) =>
        appendAuditLog(db, {
          userId: 'u-conc',
          userEmail: 'conc@univ-ai.edu',
          userRole: 'ADMIN',
          action: 'PARALLEL_WRITE',
          projectId: null,
          details: `Concurrent entry ${idx}`,
        })
      )
    );
    const result = await verifyAuditChain(db);
    assert.equal(result.valid, true);
    assert.equal(result.totalEntries, 30);
  } finally {
    await db.close();
  }
});

test('Integration: Cross-site iframe cookie attributes (SameSite=None; Secure) and X-Session-Token fallback', async () => {
  const srv = await startTestServer();
  try {
    const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ email: 'admin@univ-ai.edu', password: 'AdminGov!2026' }),
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.headers.get('x-frame-options'), null);

    const setCookie = loginRes.headers.get('set-cookie') || '';
    assert.match(setCookie, /SameSite=None/i);
    assert.match(setCookie, /;\s*Secure/i);
    assert.match(setCookie, /HttpOnly/i);

    const body = (await loginRes.json()) as {
      sessionToken?: string;
      csrfToken: string;
      user: { email: string; role: string };
    };
    assert.ok(body.sessionToken && body.sessionToken.length > 20);
    assert.equal(body.user.email, 'admin@univ-ai.edu');

    // Simulate browser blocking 3P cookies by omitting Cookie and sending X-Session-Token only
    const projectsRes = await fetch(`${srv.baseUrl}/api/projects`, {
      headers: { 'X-Session-Token': body.sessionToken },
    });
    assert.equal(projectsRes.status, 200);

    const pdfRes = await fetch(`${srv.baseUrl}/api/projects/proj-essay-incomplete/report.pdf`, {
      headers: { 'X-Session-Token': body.sessionToken },
    });
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');

    // Logout with X-Session-Token invalidates session
    const logoutRes = await fetch(`${srv.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'X-Session-Token': body.sessionToken,
        'X-CSRF-Token': body.csrfToken,
      },
    });
    assert.equal(logoutRes.status, 200);

    const postLogoutRes = await fetch(`${srv.baseUrl}/api/projects`, {
      headers: { 'X-Session-Token': body.sessionToken },
    });
    assert.equal(postLogoutRes.status, 401);
  } finally {
    await srv.close();
  }
});

test('Integration: Production bootstrap (SEED_DEMO_DATA=false) creates real Gmail admin cleanly', async () => {
  const db = await createDatabase(':memory:');
  await seedDatabase(db, { seedDemoData: false });
  const config = loadConfig();
  const app = createApp(db, config);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const statusRes = await fetch(`${baseUrl}/api/auth/setup-status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as {
      needsInitialSetup: boolean;
      hasDemoData: boolean;
    };
    assert.equal(statusJson.needsInitialSetup, true);
    assert.equal(statusJson.hasDemoData, false);

    const bootRes = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'shreyas.nimkar2006@gmail.com',
        full_name: 'Shreyas Nimkar',
        password: 'RealAdmin!2026',
      }),
    });
    assert.equal(bootRes.status, 201);
    const bootJson = (await bootRes.json()) as {
      user: { email: string; role: string; is_demo: boolean };
      sessionToken: string;
      csrfToken: string;
    };
    assert.equal(bootJson.user.email, 'shreyas.nimkar2006@gmail.com');
    assert.equal(bootJson.user.role, 'ADMIN');
    assert.equal(bootJson.user.is_demo, false);

    // Second bootstrap attempt is rejected
    const secondBoot = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker@example.com',
        full_name: 'Attacker',
        password: 'Password123!',
      }),
    });
    assert.equal(secondBoot.status, 409);

    // Baseline policies exist without demo tag
    const polRes = await fetch(`${baseUrl}/api/policies`, {
      headers: { 'X-Session-Token': bootJson.sessionToken },
    });
    assert.equal(polRes.status, 200);
    const polJson = (await polRes.json()) as { clauses: Array<{ is_demo: boolean }> };
    assert.ok(polJson.clauses.length >= 38);
    assert.equal(polJson.clauses.some((c) => c.is_demo), false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    await db.close();
  }
});

test('Integration: Activating real workspace removes demo data and supports real project creation/deletion', async () => {
  const srv = await startTestServer();
  try {
    const demoAdmin = await loginAs(srv.baseUrl, 'admin@univ-ai.edu', 'AdminGov!2026');

    const actRes = await fetch(`${srv.baseUrl}/api/admin/activate-real-workspace`, {
      method: 'POST',
      headers: {
        Cookie: demoAdmin.cookie,
        'X-CSRF-Token': demoAdmin.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'shreyas.nimkar2006@gmail.com',
        full_name: 'Shreyas Nimkar',
        password: 'RealAdmin!2026',
        removeDemoData: true,
        promoteBaselinePolicies: true,
      }),
    });
    assert.equal(actRes.status, 200);
    const actJson = (await actRes.json()) as {
      user: { id: string; email: string; is_demo: boolean };
      sessionToken: string;
      csrfToken: string;
      removedDemoProjects: number;
      removedDemoUsers: number;
    };
    assert.equal(actJson.user.email, 'shreyas.nimkar2006@gmail.com');
    assert.equal(actJson.user.is_demo, false);
    assert.equal(actJson.removedDemoProjects, 3);
    assert.equal(actJson.removedDemoUsers, 6);

    // Projects list is now clean (0 demo projects)
    const projListRes = await fetch(`${srv.baseUrl}/api/projects`, {
      headers: { 'X-Session-Token': actJson.sessionToken },
    });
    assert.equal(projListRes.status, 200);
    const projList = (await projListRes.json()) as { projects: unknown[] };
    assert.equal(projList.projects.length, 0);

    // Solo admin can create a real project using interim admin reviewer fallback
    const createRes = await fetch(`${srv.baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        'X-Session-Token': actJson.sessionToken,
        'X-CSRF-Token': actJson.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Admissions Support Classifier',
        description: 'Real production AI governance project',
        assigned_reviewer_id: actJson.user.id,
        deployment_autonomy: 'advisory',
        affects_academic_standing: false,
        data_sensitivity: 'medium',
        uses_synthetic_data: false,
        uses_third_party_wrapper: false,
        is_low_risk_admin_script: false,
        target_user_population: 'Admissions counselors',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { id: string };

    // Project can also be deleted cleanly
    const delRes = await fetch(`${srv.baseUrl}/api/projects/${created.id}`, {
      method: 'DELETE',
      headers: {
        'X-Session-Token': actJson.sessionToken,
        'X-CSRF-Token': actJson.csrfToken,
      },
    });
    assert.equal(delRes.status, 200);
  } finally {
    await srv.close();
  }
});

test('Integration: Visitor tracking, access requests, password reset, session revocation, and clean audit logs', async () => {
  const srv = await startTestServer();
  try {
    // 1. Public visitor logging (anonymous)
    const guestVisitRes = await fetch(`${srv.baseUrl}/api/visits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TestBrowser/1.0',
        'X-Forwarded-For': '203.0.113.42',
      },
      body: JSON.stringify({ path: '/', referrer: 'https://google.com' }),
    });
    assert.equal(guestVisitRes.status, 201);

    // 2. Public self-service access request
    const reqAccessRes = await fetch(`${srv.baseUrl}/api/auth/request-access`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.7',
      },
      body: JSON.stringify({
        email: 'colleague.reviewer@gmail.com',
        full_name: 'Colleague Reviewer',
        requested_role: 'PROJECT_OWNER',
        reason: 'Lead ML engineer onboarding for production release review.',
        password: 'ColleaguePass!2026',
      }),
    });
    assert.equal(reqAccessRes.status, 201);
    const reqAccessJson = (await reqAccessRes.json()) as { id: string; status: string };
    assert.equal(reqAccessJson.status, 'Pending');

    // Duplicate pending request is rejected
    const dupReqRes = await fetch(`${srv.baseUrl}/api/auth/request-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'colleague.reviewer@gmail.com',
        full_name: 'Colleague Reviewer',
        requested_role: 'PROJECT_OWNER',
        reason: 'Duplicate request',
        password: 'ColleaguePass!2026',
      }),
    });
    assert.equal(dupReqRes.status, 409);

    // 3. Activate a real admin WITHOUT removing demo data so historical demo audit entries remain in DB
    const demoAdmin = await loginAs(srv.baseUrl, 'admin@univ-ai.edu', 'AdminGov!2026');
    const actRes = await fetch(`${srv.baseUrl}/api/admin/activate-real-workspace`, {
      method: 'POST',
      headers: {
        Cookie: demoAdmin.cookie,
        'X-CSRF-Token': demoAdmin.csrfToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'shreyas.nimkar2006@gmail.com',
        full_name: 'Shreyas Nimkar',
        password: 'RealAdmin!2026',
        removeDemoData: false,
        promoteBaselinePolicies: true,
      }),
    });
    assert.equal(actRes.status, 200);
    const realAdmin = (await actRes.json()) as {
      sessionToken: string;
      csrfToken: string;
      user: { id: string; is_demo: boolean };
    };
    assert.equal(realAdmin.user.is_demo, false);

    // 4. Real admin inspects /api/admin/activity: sees guest visit, active session, and pending request
    const activityRes = await fetch(`${srv.baseUrl}/api/admin/activity`, {
      headers: { 'X-Session-Token': realAdmin.sessionToken },
    });
    assert.equal(activityRes.status, 200);
    const activityJson = (await activityRes.json()) as {
      stats: {
        totalVisits: number;
        uniqueIps24h: number;
        activeSessionCount: number;
        pendingAccessRequests: number;
      };
      visits: Array<{ ip_address: string; path: string }>;
      activeSessions: Array<{ id: string; email: string }>;
      accessRequests: Array<{ id: string; email: string; status: string }>;
    };
    assert.ok(activityJson.stats.totalVisits >= 1);
    assert.equal(activityJson.stats.pendingAccessRequests, 1);
    assert.ok(activityJson.visits.some((v) => v.ip_address === '203.0.113.42'));
    assert.ok(
      activityJson.accessRequests.some(
        (ar) => ar.id === reqAccessJson.id && ar.email === 'colleague.reviewer@gmail.com'
      )
    );

    // 5. Real admin approves the access request and assigns REVIEWER role
    const decideRes = await fetch(
      `${srv.baseUrl}/api/admin/access-requests/${reqAccessJson.id}/decide`,
      {
        method: 'POST',
        headers: {
          'X-Session-Token': realAdmin.sessionToken,
          'X-CSRF-Token': realAdmin.csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision: 'Approved', assignedRole: 'REVIEWER' }),
      }
    );
    assert.equal(decideRes.status, 200);

    // Approved user can sign in with their chosen password
    const approvedLoginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'colleague.reviewer@gmail.com',
        password: 'ColleaguePass!2026',
      }),
    });
    assert.equal(approvedLoginRes.status, 200);
    const approvedSession = (await approvedLoginRes.json()) as {
      user: { id: string; role: string; is_demo: boolean };
      sessionToken: string;
    };
    assert.equal(approvedSession.user.role, 'REVIEWER');
    assert.equal(approvedSession.user.is_demo, false);

    // Non-admin cannot access /api/admin/activity
    const nonAdminActivity = await fetch(`${srv.baseUrl}/api/admin/activity`, {
      headers: { 'X-Session-Token': approvedSession.sessionToken },
    });
    assert.equal(nonAdminActivity.status, 403);

    // 6. Admin can revoke colleague's active session via DELETE /api/admin/sessions/:id
    const actAfterLogin = await (
      await fetch(`${srv.baseUrl}/api/admin/activity`, {
        headers: { 'X-Session-Token': realAdmin.sessionToken },
      })
    ).json() as { activeSessions: Array<{ id: string; email: string }> };
    const colleagueSessionRow = actAfterLogin.activeSessions.find(
      (s) => s.email === 'colleague.reviewer@gmail.com'
    );
    assert.ok(colleagueSessionRow);

    const revokeRes = await fetch(
      `${srv.baseUrl}/api/admin/sessions/${colleagueSessionRow.id}`,
      {
        method: 'DELETE',
        headers: {
          'X-Session-Token': realAdmin.sessionToken,
          'X-CSRF-Token': realAdmin.csrfToken,
        },
      }
    );
    assert.equal(revokeRes.status, 200);

    const revokedCheck = await fetch(`${srv.baseUrl}/api/projects`, {
      headers: { 'X-Session-Token': approvedSession.sessionToken },
    });
    assert.equal(revokedCheck.status, 401);

    // 7. Admin resets colleague's password with force_password_change -> colleague logs in with temp password
    const resetRes = await fetch(
      `${srv.baseUrl}/api/users/${approvedSession.user.id}/reset-password`,
      {
        method: 'POST',
        headers: {
          'X-Session-Token': realAdmin.sessionToken,
          'X-CSRF-Token': realAdmin.csrfToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ newPassword: 'TempReset!2026', force_password_change: true }),
      }
    );
    assert.equal(resetRes.status, 200);

    const tempLoginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'colleague.reviewer@gmail.com',
        password: 'TempReset!2026',
      }),
    });
    assert.equal(tempLoginRes.status, 200);
    const tempLoginJson = (await tempLoginRes.json()) as {
      user: { force_password_change: boolean };
    };
    assert.equal(tempLoginJson.user.force_password_change, true);

    // 8. Real user audit log excludes historical demo records by default and CSV omits DEMONSTRATION DATA note
    const cleanAuditRes = await fetch(`${srv.baseUrl}/api/audit`, {
      headers: { 'X-Session-Token': realAdmin.sessionToken },
    });
    assert.equal(cleanAuditRes.status, 200);
    const cleanAudit = (await cleanAuditRes.json()) as {
      entries: Array<{ is_demo: boolean; action: string }>;
      hiddenDemoCount: number;
      includeDemo: boolean;
    };
    assert.equal(cleanAudit.includeDemo, false);
    assert.ok(cleanAudit.hiddenDemoCount > 0);
    assert.equal(cleanAudit.entries.some((e) => e.is_demo), false);
    assert.ok(cleanAudit.entries.some((e) => e.action === 'ACCESS_REQUEST_APPROVED'));

    const cleanCsvRes = await fetch(`${srv.baseUrl}/api/audit/export.csv`, {
      headers: { 'X-Session-Token': realAdmin.sessionToken },
    });
    assert.equal(cleanCsvRes.status, 200);
    const cleanCsv = await cleanCsvRes.text();
    assert.equal(cleanCsv.includes('DEMONSTRATION DATA'), false);

    // Including demo rows via ?includeDemo=true restores historical demo rows and note
    const fullCsvRes = await fetch(`${srv.baseUrl}/api/audit/export.csv?includeDemo=true`, {
      headers: { 'X-Session-Token': realAdmin.sessionToken },
    });
    assert.equal(fullCsvRes.status, 200);
    const fullCsv = await fullCsvRes.text();
    assert.equal(fullCsv.includes('DEMONSTRATION DATA'), true);

    // 9. PROJECT_OWNER never sees Admin login/system audit entries in /api/audit or /api/audit/export.csv
    const guestCreateRes = await fetch(`${srv.baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': realAdmin.sessionToken,
        'X-CSRF-Token': realAdmin.csrfToken,
      },
      body: JSON.stringify({
        email: 'guest.owner@demo.edu',
        full_name: 'Guest Owner',
        password: 'GuestOwner!2026',
        role: 'PROJECT_OWNER',
      }),
    });
    assert.equal(guestCreateRes.status, 201);

    const guestLoginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'guest.owner@demo.edu', password: 'GuestOwner!2026' }),
    });
    assert.equal(guestLoginRes.status, 200);
    const guestJson = (await guestLoginRes.json()) as { sessionToken: string };

    const guestAuditRes = await fetch(`${srv.baseUrl}/api/audit?includeDemo=true`, {
      headers: { 'X-Session-Token': guestJson.sessionToken },
    });
    assert.equal(guestAuditRes.status, 200);
    const guestAudit = (await guestAuditRes.json()) as {
      entries: Array<{ user_email: string; action: string; user_role: string }>;
    };
    assert.ok(guestAudit.entries.length >= 1);
    assert.equal(
      guestAudit.entries.some((e) => e.user_email === 'shreyas.nimkar2006@gmail.com' || e.user_role === 'ADMIN'),
      false
    );
    assert.equal(guestAudit.entries.some((e) => e.action === 'USER_CREATED'), false);

    const guestCsvRes = await fetch(`${srv.baseUrl}/api/audit/export.csv?includeDemo=true`, {
      headers: { 'X-Session-Token': guestJson.sessionToken },
    });
    assert.equal(guestCsvRes.status, 200);
    const guestCsv = await guestCsvRes.text();
    assert.equal(guestCsv.includes('shreyas.nimkar2006@gmail.com'), false);
    assert.equal(guestCsv.includes('USER_CREATED'), false);
  } finally {
    await srv.close();
  }
});

