import crypto from 'crypto';
import { appendAuditLog } from './audit';
import { hashPassword } from './auth';
import { loadConfig } from './config';
import { createDatabase, DbClient } from './db';
import { ARTEFACTS } from './knowledge';
import { DEFAULT_RULES } from './ruleEngine';
import { BENCHMARK_CASES, DEFAULT_SETTINGS, DEMO_POLICY_CLAUSES } from './seedData';
import { runAndPersistAssessment } from './workflow';

export interface SeedOptions {
  force?: boolean;
  seedDemoData?: boolean;
}

export async function seedDatabase(
  db: DbClient,
  forceOrOptions: boolean | SeedOptions = false
): Promise<void> {
  const force = typeof forceOrOptions === 'boolean' ? forceOrOptions : Boolean(forceOrOptions.force);
  const config = loadConfig();
  const seedDemoData =
    typeof forceOrOptions === 'object' && forceOrOptions.seedDemoData !== undefined
      ? forceOrOptions.seedDemoData
      : config.seedDemoData;

  const existingRules = await db.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM rules`);
  const existingUsers = await db.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM users`);
  if (!force && ((existingUsers && Number(existingUsers.cnt) > 0) || (!seedDemoData && existingRules && Number(existingRules.cnt) > 0))) {
    return;
  }

  const now = new Date().toISOString();
  const futureExpiry = new Date(Date.now() + 180 * 86400 * 1000).toISOString();
  const pastExpiry = new Date(Date.now() - 15 * 86400 * 1000).toISOString();
  const dbBool = (val: boolean) => (db.isPostgres ? val : val ? 1 : 0);

  // 1. Settings
  await db.execute(
    `INSERT INTO settings (
      id, missingness_threshold, parity_tolerance, readiness_threshold,
      retrieval_high_threshold, retrieval_medium_threshold, hybrid_weight,
      bm25_k1, bm25_b, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      missingness_threshold = excluded.missingness_threshold,
      parity_tolerance = excluded.parity_tolerance,
      readiness_threshold = excluded.readiness_threshold,
      retrieval_high_threshold = excluded.retrieval_high_threshold,
      retrieval_medium_threshold = excluded.retrieval_medium_threshold,
      hybrid_weight = excluded.hybrid_weight,
      bm25_k1 = excluded.bm25_k1,
      bm25_b = excluded.bm25_b,
      updated_at = excluded.updated_at`,
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

  // 2. Rules
  for (const r of DEFAULT_RULES) {
    await db.execute(
      `INSERT INTO rules (
        id, name, type, priority, stage, severity, supported_governance_req,
        condition_summary, action_summary, dependencies_json, enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
      [
        r.id,
        r.name,
        r.type,
        r.priority,
        r.stage,
        r.severity,
        r.supported_governance_req,
        r.condition_summary,
        r.action_summary,
        JSON.stringify(r.dependencies),
        dbBool(r.enabled),
        now,
      ]
    );
  }

  // 3. Policy Clauses (38 baseline clauses)
  for (const c of DEMO_POLICY_CLAUSES) {
    await db.execute(
      `INSERT INTO policy_clauses (
        clause_id, source, section_number, title, text, tags_json,
        related_clause_ids_json, is_active, is_demo, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(clause_id) DO NOTHING`,
      [
        c.clause_id,
        c.source,
        c.section_number,
        c.title,
        c.text,
        JSON.stringify(c.tags),
        JSON.stringify(c.related_clause_ids),
        dbBool(c.is_active),
        dbBool(seedDemoData),
        now,
      ]
    );
  }

  // 4. Benchmark cases (36 cases: 12 normal, 12 edge, 12 incomplete)
  for (const bc of BENCHMARK_CASES) {
    await db.execute(
      `INSERT INTO benchmark_cases (
        id, category, title, description, assumptions_json, acceptance_criteria,
        evidence_snapshot_json, ground_truth_missing_json, ground_truth_gates_json,
        ground_truth_clauses_json, needs_two_hop, is_demo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
      [
        bc.id,
        bc.category,
        bc.title,
        bc.description,
        JSON.stringify(bc.assumptions),
        bc.acceptance_criteria,
        JSON.stringify(bc.evidence_snapshot),
        JSON.stringify(bc.ground_truth_missing_artefacts),
        JSON.stringify(bc.ground_truth_gates),
        JSON.stringify(bc.ground_truth_clause_ids),
        dbBool(bc.needs_two_hop),
        dbBool(seedDemoData),
      ]
    );
  }

  if (!seedDemoData) {
    const initEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
    const initPassword = process.env.INITIAL_ADMIN_PASSWORD?.trim();
    const initName = process.env.INITIAL_ADMIN_NAME?.trim() || 'Workspace Administrator';
    if (initEmail && initPassword && initPassword.length >= 8) {
      const adminId = `user-${crypto.randomBytes(5).toString('hex')}`;
      await db.execute(
        `INSERT INTO users (id, email, full_name, password_hash, role, is_active, force_password_change, is_demo, created_at)
         VALUES (?, ?, ?, ?, 'ADMIN', ?, ?, ?, ?)
         ON CONFLICT(email) DO NOTHING`,
        [adminId, initEmail, initName, hashPassword(initPassword), dbBool(true), dbBool(false), dbBool(false), now]
      );
      await appendAuditLog(db, {
        userId: adminId,
        userEmail: initEmail,
        userRole: 'ADMIN',
        action: 'SYSTEM_INIT',
        projectId: null,
        details: `Initialized production workspace with administrator ${initEmail}.`,
        sourceIp: '127.0.0.1',
        isDemo: false,
      });
    }
    return;
  }

  // 5. Demo users (1 Admin, 2 Owners, 2 Reviewers, 1 Risk Acceptance Authority)
  const demoUsers = [
    {
      id: 'user-admin-1',
      email: 'admin@univ-ai.edu',
      full_name: 'Alex Rivera (Governance Admin)',
      password_hash: hashPassword('AdminGov!2026'),
      role: 'ADMIN',
    },
    {
      id: 'user-owner-1',
      email: 'maya.patel@univ-ai.edu',
      full_name: 'Maya Patel (CS Capstone Lead)',
      password_hash: hashPassword('OwnerMaya!2026'),
      role: 'PROJECT_OWNER',
    },
    {
      id: 'user-owner-2',
      email: 'liam.chen@univ-ai.edu',
      full_name: 'Liam Chen (EdTech Lab Lead)',
      password_hash: hashPassword('OwnerLiam!2026'),
      role: 'PROJECT_OWNER',
    },
    {
      id: 'user-reviewer-1',
      email: 'dr.sara.okafor@univ-ai.edu',
      full_name: 'Dr. Sara Okafor (Ethics Reviewer)',
      password_hash: hashPassword('ReviewSara!2026'),
      role: 'REVIEWER',
    },
    {
      id: 'user-reviewer-2',
      email: 'prof.david.kim@univ-ai.edu',
      full_name: 'Prof. David Kim (ML Audit Reviewer)',
      password_hash: hashPassword('ReviewDavid!2026'),
      role: 'REVIEWER',
    },
    {
      id: 'user-raa-1',
      email: 'raa.helen.grant@univ-ai.edu',
      full_name: 'Helen Grant (Risk Acceptance Authority)',
      password_hash: hashPassword('RiskHelen!2026'),
      role: 'RISK_ACCEPTANCE_AUTHORITY',
    },
  ];

  for (const u of demoUsers) {
    await db.execute(
      `INSERT INTO users (id, email, full_name, password_hash, role, is_active, force_password_change, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [u.id, u.email, u.full_name, u.password_hash, u.role, dbBool(true), dbBool(false), dbBool(true), now]
    );
  }

  // 6. Seed 3 Demo Projects
  const projects = [
    {
      id: 'proj-advising-complete',
      name: 'Course Advising Eligibility Classifier',
      description:
        'Advisory decision-support model helping academic advisors identify students eligible for accelerated prerequisite waivers based on prior coursework.',
      owner_id: 'user-owner-1',
      assigned_reviewer_id: 'user-reviewer-1',
      deployment_autonomy: 'advisory',
      affects_academic_standing: true,
      data_sensitivity: 'medium',
      uses_synthetic_data: false,
      uses_third_party_wrapper: false,
      is_low_risk_admin_script: false,
      target_user_population: 'Undergraduate academic advisors and CS students',
      workflow_state: 'Cleared for Controlled Release',
    },
    {
      id: 'proj-synthetic-edge',
      name: 'Student Advising Chatbot Wrapper (Synthetic Augmentation)',
      description:
        'Conversational advising FAQ assistant built on a third-party foundation model wrapper using synthetic dialogue augmentation for degree handbook queries.',
      owner_id: 'user-owner-2',
      assigned_reviewer_id: 'user-reviewer-2',
      deployment_autonomy: 'advisory',
      affects_academic_standing: false,
      data_sensitivity: 'low',
      uses_synthetic_data: true,
      uses_third_party_wrapper: true,
      is_low_risk_admin_script: false,
      target_user_population: 'First-year undergraduates and advising desk',
      workflow_state: 'Exception Requested',
    },
    {
      id: 'proj-essay-incomplete',
      name: 'Automated Essay Grading Triage Model',
      description:
        'Automated scoring triage model for introductory writing assessments. Reports aggregate accuracy only, lacks subgroup fairness breakdown, has an expired ethics approval, and omits a rollback plan.',
      owner_id: 'user-owner-1',
      assigned_reviewer_id: 'user-reviewer-1',
      deployment_autonomy: 'automated_action',
      affects_academic_standing: true,
      data_sensitivity: 'high',
      uses_synthetic_data: false,
      uses_third_party_wrapper: false,
      is_low_risk_admin_script: false,
      target_user_population: 'First-year composition courses',
      workflow_state: 'Draft',
    },
  ];

  for (const p of projects) {
    await db.execute(
      `INSERT INTO projects (
        id, name, description, owner_id, assigned_reviewer_id, deployment_autonomy,
        affects_academic_standing, data_sensitivity, uses_synthetic_data,
        uses_third_party_wrapper, is_low_risk_admin_script, target_user_population,
        workflow_state, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
      [
        p.id,
        p.name,
        p.description,
        p.owner_id,
        p.assigned_reviewer_id,
        p.deployment_autonomy,
        dbBool(p.affects_academic_standing),
        p.data_sensitivity,
        dbBool(p.uses_synthetic_data),
        dbBool(p.uses_third_party_wrapper),
        dbBool(p.is_low_risk_admin_script),
        p.target_user_population,
        p.workflow_state,
        dbBool(true),
        now,
        now,
      ]
    );
  }

  // Evidence for Project 1: All 21 artefacts Verified and in-date
  for (const art of ARTEFACTS) {
    await db.execute(
      `INSERT INTO project_evidence (
        id, project_id, artefact_id, status, notes, external_link, expiry_date, missingness_pct, updated_by, updated_at
      ) VALUES (?, ?, ?, 'Verified', ?, ?, ?, ?, 'user-reviewer-1', ?)
      ON CONFLICT(project_id, artefact_id) DO NOTHING`,
      [
        `ev-p1-${art.id}`,
        'proj-advising-complete',
        art.id,
        `Verified documentation for ${art.name} reviewed under Stage ${art.stage} criteria.`,
        `https://governance.univ-ai.edu/docs/advising/${art.id}.pdf`,
        art.id === 'ethics_board_signoff' ? futureExpiry : null,
        art.id === 'schema_profile' ? 0.014 : null,
        now,
      ]
    );
  }

  await db.execute(
    `INSERT INTO fairness_checks (project_id, metric_name, cohorts_json, max_gap, tolerance_used, passed, checked_at)
     VALUES (?, 'F1 Score', ?, 0.021, 0.05, ?, ?)
     ON CONFLICT(project_id) DO NOTHING`,
    [
      'proj-advising-complete',
      JSON.stringify([
        { cohort: 'Domestic Students', metricName: 'F1 Score', value: 0.892 },
        { cohort: 'International Students', metricName: 'F1 Score', value: 0.871 },
        { cohort: 'First-Generation Students', metricName: 'F1 Score', value: 0.884 },
      ]),
      dbBool(true),
      now,
    ]
  );

  // Evidence for Project 2: Synthetic-data edge case (most verified, provenance_log Submitted, local_explanation_examples Unclear)
  for (const art of ARTEFACTS) {
    let status: string = 'Verified';
    let notes = `Verified baseline evidence for ${art.name}.`;
    if (art.id === 'provenance_log') {
      status = 'Submitted';
      notes = 'Synthetic dialogue prompt templates documented; external vendor corpus weights unavailable.';
    } else if (art.id === 'architecture_rationale') {
      status = 'Submitted';
      notes = 'Third-party API wrapper rationale documented; seeking exception for internal weights.';
    } else if (art.id === 'local_explanation_examples') {
      status = 'Unclear';
      notes = 'Sample chat citations provided, but reviewer requested clearer mapping to handbook sections.';
    }
    await db.execute(
      `INSERT INTO project_evidence (
        id, project_id, artefact_id, status, notes, external_link, expiry_date, missingness_pct, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user-owner-2', ?)
      ON CONFLICT(project_id, artefact_id) DO NOTHING`,
      [
        `ev-p2-${art.id}`,
        'proj-synthetic-edge',
        art.id,
        status,
        notes,
        `https://governance.univ-ai.edu/docs/chatbot/${art.id}.pdf`,
        art.id === 'ethics_board_signoff' ? futureExpiry : null,
        art.id === 'schema_profile' ? 0.022 : null,
        now,
      ]
    );
  }

  // Pending exception on Project 2
  await db.execute(
    `INSERT INTO exceptions (
      id, project_id, requester_id, target_type, target_id, rationale, expiry_date, status, is_demo, created_at
    ) VALUES (?, ?, ?, 'artefact', 'provenance_log', ?, ?, 'Pending', ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      'EX-DEMO-201',
      'proj-synthetic-edge',
      'user-owner-2',
      'Synthetic training conversations were generated from public course catalog text; upstream foundation model training lineage is proprietary to the external provider.',
      futureExpiry,
      dbBool(true),
      now,
    ]
  );

  // Evidence for Project 3: Incomplete high-risk project
  for (const art of ARTEFACTS) {
    let status: string = 'Verified';
    let notes = `Initial document uploaded for ${art.name}.`;
    let expiry: string | null = null;
    if (art.id === 'subgroup_error_matrix') {
      status = 'Not submitted';
      notes = 'Only aggregate accuracy (84.2%) reported so far; per-cohort breakdown pending.';
    } else if (art.id === 'rollback_plan') {
      status = 'Not submitted';
      notes = '';
    } else if (art.id === 'ethics_board_signoff') {
      status = 'Verified';
      expiry = pastExpiry;
      notes = 'Prior pilot approval expired 15 days ago; renewal required for automated grading.';
    } else if (art.id === 'global_feature_attribution' || art.id === 'limitation_note') {
      status = 'Submitted';
      notes = 'Draft submitted by capstone team, awaiting reviewer check.';
    } else if (art.id === 'misuse_assessment') {
      status = 'Not submitted';
      notes = '';
    }
    await db.execute(
      `INSERT INTO project_evidence (
        id, project_id, artefact_id, status, notes, external_link, expiry_date, missingness_pct, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user-owner-1', ?)
      ON CONFLICT(project_id, artefact_id) DO NOTHING`,
      [
        `ev-p3-${art.id}`,
        'proj-essay-incomplete',
        art.id,
        status,
        notes,
        status === 'Not submitted' ? null : `https://governance.univ-ai.edu/docs/essay/${art.id}.pdf`,
        expiry,
        art.id === 'schema_profile' ? 0.031 : null,
        now,
      ]
    );
  }

  await db.execute(
    `INSERT INTO fairness_checks (project_id, metric_name, cohorts_json, max_gap, tolerance_used, passed, checked_at)
     VALUES (?, 'Accuracy', ?, 0.142, 0.05, ?, ?)
     ON CONFLICT(project_id) DO NOTHING`,
    [
      'proj-essay-incomplete',
      JSON.stringify([
        { cohort: 'Native English Writers', metricName: 'Accuracy', value: 0.892 },
        { cohort: 'ESL / Multilingual Writers', metricName: 'Accuracy', value: 0.750 },
      ]),
      dbBool(false),
      now,
    ]
  );

  // Add initial review comments
  await db.execute(
    `INSERT INTO review_comments (id, project_id, author_id, comment, action_type, is_demo, created_at)
     VALUES (?, ?, ?, ?, 'SIGN_OFF', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [
      'RC-DEMO-1',
      'proj-advising-complete',
      'user-reviewer-1',
      'All six stages verified and subgroup parity gap (0.021) is well within the 0.05 tolerance. Cleared for controlled release.',
      dbBool(true),
      now,
    ]
  );

  await db.execute(
    `INSERT INTO review_comments (id, project_id, author_id, comment, action_type, is_demo, created_at)
     VALUES (?, ?, ?, ?, 'COMMENT', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [
      'RC-DEMO-2',
      'proj-essay-incomplete',
      'user-reviewer-1',
      'Aggregate accuracy hides a 14.2% disparity for multilingual writers. Ethics sign-off is also expired and automated grading lacks a rollback plan.',
      dbBool(true),
      now,
    ]
  );

  await appendAuditLog(db, {
    userId: 'user-admin-1',
    userEmail: 'admin@univ-ai.edu',
    userRole: 'ADMIN',
    action: 'SYSTEM_SEED',
    projectId: null,
    details: 'Seeded demonstration users, 38 policy clauses, 36 benchmark cases, and 3 lifecycle projects.',
    sourceIp: '127.0.0.1',
    isDemo: true,
  });

  // Run initial live assessments on all 3 projects
  const adminUser = {
    id: 'user-admin-1',
    email: 'admin@univ-ai.edu',
    full_name: 'Alex Rivera (Governance Admin)',
    role: 'ADMIN' as const,
    is_active: true,
    force_password_change: false,
    is_demo: true,
    created_at: now,
  };

  for (const p of projects) {
    await runAndPersistAssessment(db, p.id, adminUser, '127.0.0.1');
  }
}

// Allow running directly via `npm run seed`
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'));

if (isDirectRun) {
  (async () => {
    const config = loadConfig();
    const db = await createDatabase(config.databaseUrl);
    await seedDatabase(db, true);
    console.log('Seed completed successfully.');
    await db.close();
  })().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
