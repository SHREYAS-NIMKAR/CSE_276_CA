import assert from 'node:assert/strict';
import test from 'node:test';
import { ARTEFACTS, RISKS } from '../server/knowledge';
import {
  computeBm25Scores,
  computeTfIdfCosineScores,
  normalizeScores,
  retrievePolicyClauses,
  tokenize,
} from '../server/retrieval';
import { DEFAULT_RULES, runForwardChainingAssessment } from '../server/ruleEngine';
import { DEFAULT_SETTINGS, DEMO_POLICY_CLAUSES } from '../server/seedData';
import { EvidenceRecord, ExceptionRecord, PolicyClause, ProjectRecord, RiskAcceptanceRecord } from '../server/types';
import { validateFormalRiskAcceptance, validateProjectPayload, validateWorkflowTransition } from '../server/workflow';

function makeBaseProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  const now = new Date().toISOString();
  return {
    id: 'test-proj',
    name: 'Test Academic Classifier',
    description: 'Test project for automated unit verification.',
    owner_id: 'owner-1',
    assigned_reviewer_id: 'rev-1',
    deployment_autonomy: 'advisory',
    affects_academic_standing: false,
    data_sensitivity: 'medium',
    uses_synthetic_data: false,
    uses_third_party_wrapper: false,
    is_low_risk_admin_script: false,
    target_user_population: 'Students',
    workflow_state: 'Draft',
    is_demo: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeAllVerifiedEvidence(projectId = 'test-proj', overrides: Record<string, Partial<EvidenceRecord>> = {}): EvidenceRecord[] {
  const now = new Date().toISOString();
  return ARTEFACTS.map((a) => ({
    id: `ev-${a.id}`,
    project_id: projectId,
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
    updated_by: 'rev-1',
    updated_at: now,
    ...(overrides[a.id] ?? {}),
  }));
}

test('Scoring: Rs high with Gs = 0 keeps release locked and flags scoreHighButGateLocked', () => {
  const now = new Date();
  const project = makeBaseProject({ deployment_autonomy: 'automated_action' });
  // Stage 5: rollback_plan (0.35, blocking) missing; others verified -> Rs = 0.65 >= 0.60, Gs = 0
  const evidence = makeAllVerifiedEvidence('test-proj', {
    rollback_plan: { status: 'Not submitted' },
  });
  const res = runForwardChainingAssessment({
    project,
    evidence,
    fairnessCheck: {
      project_id: 'test-proj',
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

  const stage5 = res.stageSummaries.find((s) => s.stage === 5)!;
  assert.equal(stage5.gs, 0);
  assert.ok(stage5.rs >= 0.6);
  assert.equal(stage5.scoreHighButGateLocked, true);
  assert.equal(res.releaseLocked, true);
});

test('Forward chaining: R10 chains on derived gate_open and high_risk_open facts', () => {
  const now = new Date();
  const project = makeBaseProject({ affects_academic_standing: true });
  const evidence = makeAllVerifiedEvidence();
  const res = runForwardChainingAssessment({
    project,
    evidence,
    fairnessCheck: {
      project_id: 'test-proj',
      metric_name: 'F1',
      cohorts: [
        { cohort: 'A', metricName: 'F1', value: 0.88 },
        { cohort: 'B', metricName: 'F1', value: 0.86 },
      ],
      max_gap: 0.02,
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
  assert.ok(res.derivedFacts.includes('automated_check_passed'));
  assert.ok(res.firedRules.some((f) => f.ruleId === 'R10'));
});

test('Conflict detection & exception scope: R8 exception only clears what approved exception names', () => {
  const now = new Date();
  const future = new Date(now.getTime() + 10 * 86400 * 1000).toISOString();
  const project = makeBaseProject({ uses_synthetic_data: true });
  const evidence = makeAllVerifiedEvidence('test-proj', {
    dataset_datasheet: { status: 'Not submitted' },
    provenance_log: { status: 'Submitted' },
  });
  // Approved exception covers provenance_log ONLY, NOT dataset_datasheet (R2)
  const ex: ExceptionRecord = {
    id: 'EX-1',
    project_id: 'test-proj',
    requester_id: 'owner-1',
    target_type: 'artefact',
    target_id: 'provenance_log',
    rationale: 'Synthetic corpus',
    expiry_date: future,
    status: 'Approved',
    reviewer_id: 'rev-1',
    reviewer_comment: 'Approved for provenance only',
    reviewed_at: now.toISOString(),
    is_demo: false,
    created_at: now.toISOString(),
  };

  const res = runForwardChainingAssessment({
    project,
    evidence,
    fairnessCheck: null,
    exceptions: [ex],
    riskAcceptances: [],
    rules: DEFAULT_RULES,
    clauses: DEMO_POLICY_CLAUSES,
    settings: DEFAULT_SETTINGS,
    now,
  });

  assert.ok(res.conflicts.length >= 1);
  assert.equal(res.conflicts[0].winningRuleId, 'R2');
  assert.equal(res.stageSummaries[0].effectiveGs, 0);
  assert.equal(res.releaseLocked, true);
});

test('Expired exception re-opens blocker and records expired notice', () => {
  const now = new Date();
  const past = new Date(now.getTime() - 2 * 86400 * 1000).toISOString();
  const project = makeBaseProject();
  const evidence = makeAllVerifiedEvidence('test-proj', {
    dataset_datasheet: { status: 'Not submitted' },
  });
  const expiredEx: ExceptionRecord = {
    id: 'EX-OLD',
    project_id: 'test-proj',
    requester_id: 'owner-1',
    target_type: 'artefact',
    target_id: 'dataset_datasheet',
    rationale: 'Temp',
    expiry_date: past,
    status: 'Approved',
    reviewer_id: 'rev-1',
    reviewer_comment: 'Ok',
    reviewed_at: past,
    is_demo: false,
    created_at: past,
  };
  const res = runForwardChainingAssessment({
    project,
    evidence,
    fairnessCheck: null,
    exceptions: [expiredEx],
    riskAcceptances: [],
    rules: DEFAULT_RULES,
    clauses: DEMO_POLICY_CLAUSES,
    settings: DEFAULT_SETTINGS,
    now,
  });

  assert.equal(res.stageSummaries[0].effectiveGs, 0);
  assert.ok(res.expiredNotices.some((n) => n.includes('EX-OLD')));
});

test('Formal risk acceptance rejects non-acceptable risks, non-RAA roles, and expired acceptances reopen risks', () => {
  const now = new Date();
  const future = new Date(now.getTime() + 10 * 86400 * 1000).toISOString();
  const past = new Date(now.getTime() - 2 * 86400 * 1000).toISOString();
  const project = makeBaseProject();
  const nonAcc = RISKS.find((r) => !r.acceptableUnderPolicy)!;
  const accRisk = RISKS.find((r) => r.acceptableUnderPolicy)!;

  const raa = {
    id: 'raa-1',
    email: 'raa@u.edu',
    full_name: 'RAA',
    role: 'RISK_ACCEPTANCE_AUTHORITY' as const,
    is_active: true,
    force_password_change: false,
    is_demo: false,
    created_at: now.toISOString(),
  };

  assert.ok(
    validateFormalRiskAcceptance({
      riskId: nonAcc.id,
      project,
      actor: raa,
      rationale: 'Adequate rationale',
      scope: 'Pilot',
      expiryDate: future,
      exceptions: [],
    })
  );
  assert.equal(
    validateFormalRiskAcceptance({
      riskId: accRisk.id,
      project,
      actor: raa,
      rationale: 'Adequate rationale',
      scope: 'Pilot',
      expiryDate: future,
      exceptions: [],
    }),
    null
  );

  // Expired acceptance re-opens risk
  const evidence = makeAllVerifiedEvidence('test-proj', {
    misuse_assessment: { status: 'Not submitted' },
  });
  const expiredAcc: RiskAcceptanceRecord = {
    id: 'RA-OLD',
    project_id: 'test-proj',
    risk_id: 'RISK_FORESEEABLE_MISUSE',
    approver_id: 'raa-1',
    rationale: 'Pilot only',
    scope: 'Fall term',
    expiry_date: past,
    status: 'Active',
    is_demo: false,
    created_at: past,
  };
  const res = runForwardChainingAssessment({
    project,
    evidence,
    fairnessCheck: null,
    exceptions: [],
    riskAcceptances: [expiredAcc],
    rules: DEFAULT_RULES,
    clauses: DEMO_POLICY_CLAUSES,
    settings: DEFAULT_SETTINGS,
    now,
  });
  const r = res.riskSummaries.find((x) => x.riskId === 'RISK_FORESEEABLE_MISUSE')!;
  assert.equal(r.status, 'Open');
  assert.ok(res.expiredNotices.some((n) => n.includes('RA-OLD')));
});

test('BM25, TF-IDF cosine, hybrid normalization, 2-hop retrieval, and low-confidence routing', () => {
  const corpus: PolicyClause[] = [
    {
      clause_id: 'D1',
      source: 'Policy',
      section_number: '1',
      title: 'Subgroup Fairness Matrix',
      text: 'Protected cohorts require subgroup fairness parity verification before deployment.',
      tags: ['subgroup', 'fairness'],
      related_clause_ids: ['D2'],
      is_active: true,
      is_demo: false,
    },
    {
      clause_id: 'D2',
      source: 'Policy',
      section_number: '2',
      title: 'Protected Attribute Segregation',
      text: 'Protected attributes must stay in audit views only.',
      tags: ['protected', 'audit'],
      related_clause_ids: [],
      is_active: true,
      is_demo: false,
    },
    {
      clause_id: 'D3',
      source: 'Policy',
      section_number: '3',
      title: 'Shuttle Energy Schedule',
      text: 'Campus shuttles optimize route battery schedules.',
      tags: ['shuttle'],
      related_clause_ids: [],
      is_active: true,
      is_demo: false,
    },
  ];
  const docs = corpus.map((c) => ({
    clause: c,
    tokens: tokenize(`${c.title} ${c.text}`),
    rawTokensLower: new Set(`${c.title} ${c.text}`.toLowerCase().split(/\s+/)),
  }));
  const q = tokenize('subgroup fairness parity');
  const bm = computeBm25Scores(q, docs);
  const tf = computeTfIdfCosineScores(q, docs);
  assert.ok(bm[0] > bm[1] && bm[0] > bm[2]);
  assert.ok(tf[0] > tf[2]);
  const norm = normalizeScores(bm);
  assert.equal(norm[0], 1);

  const hits = retrievePolicyClauses('subgroup fairness parity', corpus, DEFAULT_SETTINGS, 3);
  assert.equal(hits[0].clauseId, 'D1');
  assert.equal(hits[0].relatedClauses[0].clauseId, 'D2');

  // Unmatched query yields low confidence & needsHumanInspection
  const lowHits = retrievePolicyClauses('quantum cryptography orbital', corpus, DEFAULT_SETTINGS, 3);
  assert.equal(lowHits[0].confidence, 'Low');
  assert.equal(lowHits[0].needsHumanInspection, true);
});

test('Project validation and workflow state machine enforce consistency and Section 15A', () => {
  const errs = validateProjectPayload({
    name: 'Bad Script',
    description: 'Contradictory settings test',
    assigned_reviewer_id: 'rev-1',
    deployment_autonomy: 'automated_action',
    affects_academic_standing: true,
    data_sensitivity: 'high',
    is_low_risk_admin_script: true,
    target_user_population: 'Students',
  });
  assert.ok(errs.length >= 2);

  const project = makeBaseProject({ workflow_state: 'Draft' });
  const assessment = runForwardChainingAssessment({
    project,
    evidence: makeAllVerifiedEvidence(),
    fairnessCheck: null,
    exceptions: [],
    riskAcceptances: [],
    rules: DEFAULT_RULES,
    clauses: DEMO_POLICY_CLAUSES,
    settings: DEFAULT_SETTINGS,
  });
  const rev = {
    id: 'rev-1',
    email: 'rev@u.edu',
    full_name: 'Reviewer',
    role: 'REVIEWER' as const,
    is_active: true,
    force_password_change: false,
    is_demo: false,
    created_at: new Date().toISOString(),
  };

  // Illegal jump Draft -> Cleared for Controlled Release
  const badJump = validateWorkflowTransition({
    project,
    targetState: 'Cleared for Controlled Release',
    actor: rev,
    assessment,
    exceptions: [],
    riskAcceptances: [],
  });
  assert.equal(badJump.allowed, false);
});
