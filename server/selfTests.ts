import assert from 'node:assert/strict';
import { appendAuditLog, verifyAuditChain } from './audit';
import { createDatabase } from './db';
import { runBenchmarkEvaluation } from './evaluation';
import { ARTEFACTS, RISKS } from './knowledge';
import { computeBm25Scores, computeTfIdfCosineScores, retrievePolicyClauses, tokenize } from './retrieval';
import { DEFAULT_RULES, runForwardChainingAssessment } from './ruleEngine';
import { DEFAULT_SETTINGS, DEMO_POLICY_CLAUSES } from './seedData';
import { seedDatabase } from './seed';
import { EvidenceRecord, PolicyClause, ProjectRecord } from './types';
import { validateFormalRiskAcceptance, validateWorkflowTransition } from './workflow';

export interface SelfTestItemResult {
  name: string;
  passed: boolean;
  durationMs: number;
  detail: string;
}

export interface SelfTestReport {
  ranAt: string;
  total: number;
  passed: number;
  failed: number;
  tests: SelfTestItemResult[];
}

export async function runSelfTestSuite(): Promise<SelfTestReport> {
  const tests: SelfTestItemResult[] = [];

  const runOne = async (name: string, fn: () => Promise<void> | void) => {
    const t0 = performance.now();
    try {
      await fn();
      tests.push({
        name,
        passed: true,
        durationMs: Number((performance.now() - t0).toFixed(2)),
        detail: 'Passed',
      });
    } catch (err) {
      tests.push({
        name,
        passed: false,
        durationMs: Number((performance.now() - t0).toFixed(2)),
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await runOne('Ontology stage weights sum strictly to 1.0', () => {
    for (let stage = 1; stage <= 6; stage++) {
      const sum = ARTEFACTS.filter((a) => a.stage === stage).reduce((s, a) => s + a.weight, 0);
      assert.ok(Math.abs(sum - 1.0) < 1e-6, `Stage ${stage} weight sum ${sum} != 1.0`);
    }
  });

  await runOne('Scoring keeps release locked when Rs >= threshold but Gs = 0', () => {
    const now = new Date();
    const project: ProjectRecord = {
      id: 't-proj',
      name: 'Test Model',
      description: 'Testing high Rs with missing blocking artefact.',
      owner_id: 'u1',
      assigned_reviewer_id: 'u2',
      deployment_autonomy: 'automated_action',
      affects_academic_standing: false,
      data_sensitivity: 'low',
      uses_synthetic_data: false,
      uses_third_party_wrapper: false,
      is_low_risk_admin_script: false,
      target_user_population: 'Staff',
      workflow_state: 'Draft',
      is_demo: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    const evidence: EvidenceRecord[] = ARTEFACTS.map((a) => ({
      id: a.id,
      project_id: 't-proj',
      artefact_id: a.id,
      status: a.id === 'rollback_plan' ? 'Not submitted' : 'Verified',
      notes: '',
      file_name: null,
      file_path: null,
      file_size: null,
      file_checksum: null,
      external_link: null,
      expiry_date: null,
      missingness_pct: 0.01,
      updated_by: 'u2',
      updated_at: now.toISOString(),
    }));
    const res = runForwardChainingAssessment({
      project,
      evidence,
      fairnessCheck: {
        project_id: 't-proj',
        metric_name: 'F1',
        cohorts: [
          { cohort: 'A', metricName: 'F1', value: 0.9 },
          { cohort: 'B', metricName: 'F1', value: 0.89 },
        ],
        max_gap: 0.01,
        tolerance_used: 0.05,
        passed: true,
        checked_at: now.toISOString(),
      },
      exceptions: [],
      riskAcceptances: [],
      rules: DEFAULT_RULES,
      clauses: DEMO_POLICY_CLAUSES,
      settings: { ...DEFAULT_SETTINGS, readiness_threshold: 0.6 },
      now,
    });
    const s5 = res.stageSummaries.find((s) => s.stage === 5)!;
    assert.equal(s5.gs, 0);
    assert.ok(s5.rs >= 0.6);
    assert.equal(s5.scoreHighButGateLocked, true);
    assert.equal(res.releaseLocked, true);
  });

  await runOne('Forward chaining executes R10 only when derived gates & risks clear', () => {
    const now = new Date();
    const project: ProjectRecord = {
      id: 't-proj-2',
      name: 'Complete Model',
      description: 'All artefacts verified.',
      owner_id: 'u1',
      assigned_reviewer_id: 'u2',
      deployment_autonomy: 'advisory',
      affects_academic_standing: true,
      data_sensitivity: 'medium',
      uses_synthetic_data: false,
      uses_third_party_wrapper: false,
      is_low_risk_admin_script: false,
      target_user_population: 'Students',
      workflow_state: 'Draft',
      is_demo: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    const evidence: EvidenceRecord[] = ARTEFACTS.map((a) => ({
      id: a.id,
      project_id: 't-proj-2',
      artefact_id: a.id,
      status: 'Verified',
      notes: 'Verified',
      file_name: null,
      file_path: null,
      file_size: null,
      file_checksum: null,
      external_link: null,
      expiry_date: null,
      missingness_pct: 0.01,
      updated_by: 'u2',
      updated_at: now.toISOString(),
    }));
    const res = runForwardChainingAssessment({
      project,
      evidence,
      fairnessCheck: {
        project_id: 't-proj-2',
        metric_name: 'F1',
        cohorts: [
          { cohort: 'A', metricName: 'F1', value: 0.9 },
          { cohort: 'B', metricName: 'F1', value: 0.89 },
        ],
        max_gap: 0.01,
        tolerance_used: 0.05,
        passed: true,
        checked_at: now.toISOString(),
      },
      exceptions: [],
      riskAcceptances: [],
      rules: DEFAULT_RULES,
      clauses: DEMO_POLICY_CLAUSES,
      settings: DEFAULT_SETTINGS,
      now,
    });
    assert.equal(res.automatedCheckPassed, true);
    assert.ok(res.firedRules.some((f) => f.ruleId === 'R10'));
  });

  await runOne('BM25 and TF-IDF rank matching document first and perform 2-hop retrieval', () => {
    const tinyDocs: PolicyClause[] = [
      {
        clause_id: 'C1',
        source: 'Test',
        section_number: '1',
        title: 'Rollback Plan',
        text: 'Automated systems require a tested rollback plan and kill switch.',
        tags: ['rollback'],
        related_clause_ids: ['C2'],
        is_active: true,
        is_demo: false,
      },
      {
        clause_id: 'C2',
        source: 'Test',
        section_number: '2',
        title: 'Consent Scope',
        text: 'Student records require explicit consent before training.',
        tags: ['consent'],
        related_clause_ids: [],
        is_active: true,
        is_demo: false,
      },
    ];
    const searchable = tinyDocs.map((c) => ({
      clause: c,
      tokens: tokenize(`${c.title} ${c.text}`),
      rawTokensLower: new Set(`${c.title} ${c.text}`.toLowerCase().split(/\s+/)),
    }));
    const qTokens = tokenize('rollback plan');
    const bm = computeBm25Scores(qTokens, searchable);
    const tf = computeTfIdfCosineScores(qTokens, searchable);
    assert.ok(bm[0] > bm[1]);
    assert.ok(tf[0] > tf[1]);

    const hits = retrievePolicyClauses('rollback plan', tinyDocs, DEFAULT_SETTINGS, 2);
    assert.equal(hits[0].clauseId, 'C1');
    assert.equal(hits[0].relatedClauses[0].clauseId, 'C2');
  });

  await runOne('Formal risk acceptance rejects non-acceptable policy risk and non-RAA roles', () => {
    const now = new Date();
    const project: ProjectRecord = {
      id: 'p1',
      name: 'P',
      description: 'Desc long enough',
      owner_id: 'owner1',
      assigned_reviewer_id: 'rev1',
      deployment_autonomy: 'advisory',
      affects_academic_standing: true,
      data_sensitivity: 'high',
      uses_synthetic_data: false,
      uses_third_party_wrapper: false,
      is_low_risk_admin_script: false,
      target_user_population: 'Students',
      workflow_state: 'Draft',
      is_demo: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    const nonAcceptableRisk = RISKS.find((r) => !r.acceptableUnderPolicy)!;
    const acceptableRisk = RISKS.find((r) => r.acceptableUnderPolicy)!;
    const raaUser = {
      id: 'raa1',
      email: 'raa@u.edu',
      full_name: 'RAA',
      role: 'RISK_ACCEPTANCE_AUTHORITY' as const,
      is_active: true,
      force_password_change: false,
      is_demo: false,
      created_at: now.toISOString(),
    };
    const adminUser = { ...raaUser, id: 'adm1', role: 'ADMIN' as const };
    const future = new Date(Date.now() + 86400000).toISOString();

    const err1 = validateFormalRiskAcceptance({
      riskId: nonAcceptableRisk.id,
      project,
      actor: raaUser,
      rationale: 'Valid rationale text',
      scope: 'Pilot only',
      expiryDate: future,
      exceptions: [],
    });
    assert.ok(err1 && err1.includes('acceptable_under_policy = false'));

    const err2 = validateFormalRiskAcceptance({
      riskId: acceptableRisk.id,
      project,
      actor: adminUser,
      rationale: 'Valid rationale text',
      scope: 'Pilot only',
      expiryDate: future,
      exceptions: [],
    });
    assert.ok(err2 && err2.includes('RISK_ACCEPTANCE_AUTHORITY'));
  });

  await runOne('Workflow state machine blocks illegal transitions and owner sign-off', () => {
    const now = new Date().toISOString();
    const dbProj: ProjectRecord = {
      id: 'p',
      name: 'P',
      description: 'D',
      owner_id: 'owner1',
      assigned_reviewer_id: 'rev1',
      deployment_autonomy: 'advisory',
      affects_academic_standing: false,
      data_sensitivity: 'low',
      uses_synthetic_data: false,
      uses_third_party_wrapper: false,
      is_low_risk_admin_script: false,
      target_user_population: 'Staff',
      workflow_state: 'Draft',
      is_demo: false,
      created_at: now,
      updated_at: now,
    };
    const dummyAssessment = runForwardChainingAssessment({
      project: dbProj,
      evidence: [],
      fairnessCheck: null,
      exceptions: [],
      riskAcceptances: [],
      rules: DEFAULT_RULES,
      clauses: DEMO_POLICY_CLAUSES,
      settings: DEFAULT_SETTINGS,
    });
    const res = validateWorkflowTransition({
      project: dbProj,
      targetState: 'Cleared for Controlled Release',
      actor: {
        id: 'rev1',
        email: 'rev@u.edu',
        full_name: 'Rev',
        role: 'REVIEWER',
        is_active: true,
        force_password_change: false,
        is_demo: false,
        created_at: now,
      },
      assessment: dummyAssessment,
      exceptions: [],
      riskAcceptances: [],
    });
    assert.equal(res.allowed, false);
  });

  await runOne('Audit log parallel writes produce gapless SHA-256 chain with zero forks', async () => {
    const testDb = await createDatabase(':memory:');
    try {
      await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          appendAuditLog(testDb, {
            userId: 'u1',
            userEmail: 'u1@univ-ai.edu',
            userRole: 'ADMIN',
            action: 'CONCURRENT_TEST',
            projectId: null,
            details: `Parallel write #${i}`,
          })
        )
      );
      const check = await verifyAuditChain(testDb);
      assert.equal(check.valid, true);
      assert.equal(check.totalEntries, 15);
    } finally {
      await testDb.close();
    }
  });

  await runOne('Benchmark evaluation runs end-to-end on 36 seeded cases', async () => {
    const testDb = await createDatabase(':memory:');
    try {
      await seedDatabase(testDb);
      const evalOut = await runBenchmarkEvaluation(testDb, 'user-admin-1');
      assert.equal(evalOut.summary.sampleSize, 36);
      assert.ok(evalOut.summary.governanceSystem.gateF1 >= evalOut.summary.baselineSystem.gateF1);
    } finally {
      await testDb.close();
    }
  });

  const passed = tests.filter((t) => t.passed).length;
  return {
    ranAt: new Date().toISOString(),
    total: tests.length,
    passed,
    failed: tests.length - passed,
    tests,
  };
}
