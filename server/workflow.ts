import { appendAuditLog } from './audit';
import { DbClient } from './db';
import { RISKS } from './knowledge';
import { runForwardChainingAssessment } from './ruleEngine';
import {
  AssessmentResult,
  DataSensitivity,
  DeploymentAutonomy,
  EvidenceRecord,
  ExceptionRecord,
  FairnessCheckRecord,
  PolicyClause,
  ProjectRecord,
  RiskAcceptanceRecord,
  RuleDefinition,
  SystemSettings,
  UserRecord,
  WorkflowState,
} from './types';

export interface ProjectInputPayload {
  name: string;
  description: string;
  assigned_reviewer_id: string;
  deployment_autonomy: DeploymentAutonomy;
  affects_academic_standing: boolean;
  data_sensitivity: DataSensitivity;
  uses_synthetic_data: boolean;
  uses_third_party_wrapper: boolean;
  is_low_risk_admin_script: boolean;
  target_user_population: string;
}

export function validateProjectPayload(payload: Partial<ProjectInputPayload>): string[] {
  const errors: string[] = [];
  if (!payload.name || payload.name.trim().length < 3) {
    errors.push('Project name must be at least 3 characters.');
  }
  if (!payload.description || payload.description.trim().length < 10) {
    errors.push('Project description must be at least 10 characters.');
  }
  if (!payload.target_user_population || payload.target_user_population.trim().length < 3) {
    errors.push('Target user population is required.');
  }
  if (!payload.assigned_reviewer_id) {
    errors.push('An assigned reviewer must be selected.');
  }
  if (
    payload.deployment_autonomy !== 'advisory' &&
    payload.deployment_autonomy !== 'automated_action'
  ) {
    errors.push('Deployment autonomy must be either advisory or automated_action.');
  }
  if (
    payload.data_sensitivity !== 'low' &&
    payload.data_sensitivity !== 'medium' &&
    payload.data_sensitivity !== 'high'
  ) {
    errors.push('Data sensitivity must be low, medium, or high.');
  }

  // Consistency checks
  if (
    payload.is_low_risk_admin_script &&
    payload.data_sensitivity === 'high' &&
    payload.deployment_autonomy === 'automated_action'
  ) {
    errors.push(
      'Inconsistent classification: a low-risk internal administrative script cannot be marked both high data sensitivity and automated-action deployment.'
    );
  }
  if (payload.is_low_risk_admin_script && payload.affects_academic_standing) {
    errors.push(
      'Inconsistent classification: a system affecting student academic standing cannot be classified as a low-risk internal administrative script.'
    );
  }
  return errors;
}

export const LEGAL_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  Draft: ['Automated Check Passed', 'Exception Requested', 'Exception-Based Review Eligible'],
  'Automated Check Passed': ['Reviewer Sign-Off', 'Draft', 'Exception Requested'],
  'Exception Requested': ['Exception-Based Review Eligible', 'Draft', 'Automated Check Passed'],
  'Exception-Based Review Eligible': ['Reviewer Sign-Off', 'Draft', 'Exception Requested'],
  'Reviewer Sign-Off': ['Cleared for Controlled Release', 'Draft'],
  'Cleared for Controlled Release': ['Draft'],
};

export interface TransitionCheckInput {
  project: ProjectRecord;
  targetState: WorkflowState;
  actor: UserRecord;
  assessment: AssessmentResult;
  exceptions: ExceptionRecord[];
  riskAcceptances: RiskAcceptanceRecord[];
}

export function validateWorkflowTransition(input: TransitionCheckInput): {
  allowed: boolean;
  reason: string;
} {
  const { project, targetState, actor, assessment, exceptions, riskAcceptances } = input;
  const current = project.workflow_state;

  if (current === targetState) {
    return { allowed: false, reason: `Project is already in state "${targetState}".` };
  }

  const legalTargets = LEGAL_TRANSITIONS[current] ?? [];
  if (!legalTargets.includes(targetState)) {
    return {
      allowed: false,
      reason: `Illegal state transition from "${current}" to "${targetState}".`,
    };
  }

  const now = Date.now();
  const approvedActiveExceptions = exceptions.filter(
    (e) => e.status === 'Approved' && new Date(e.expiry_date).getTime() >= now
  );
  const expiredExceptions = exceptions.filter(
    (e) =>
      e.status === 'Expired' ||
      (e.status === 'Approved' && new Date(e.expiry_date).getTime() < now)
  );
  const expiredAcceptances = riskAcceptances.filter(
    (a) =>
      a.status === 'Expired' ||
      (a.status === 'Active' && new Date(a.expiry_date).getTime() < now)
  );

  if (targetState === 'Automated Check Passed') {
    if (!assessment.automatedCheckPassed || assessment.reliesOnException) {
      return {
        allowed: false,
        reason:
          'Automated Check Passed requires rule R10 to pass without relying on exceptions, with all stages complete and no High risk open.',
      };
    }
    return { allowed: true, reason: 'Rule R10 satisfied without exceptions.' };
  }

  if (targetState === 'Exception Requested') {
    const hasPending = exceptions.some((e) => e.status === 'Pending');
    if (!hasPending) {
      return {
        allowed: false,
        reason: 'At least one pending exception request is required to enter Exception Requested.',
      };
    }
    return { allowed: true, reason: 'Pending exception recorded.' };
  }

  if (targetState === 'Exception-Based Review Eligible') {
    const allEffectiveGatesSatisfied = assessment.stageSummaries.every((s) => s.effectiveGs === 1);
    if (!allEffectiveGatesSatisfied || approvedActiveExceptions.length === 0) {
      return {
        allowed: false,
        reason:
          'Exception-Based Review Eligible requires all remaining blockers to be covered by approved, in-date exceptions.',
      };
    }
    return {
      allowed: true,
      reason: 'All blockers covered by approved in-date exceptions; eligible for human review only (not release).',
    };
  }

  if (targetState === 'Reviewer Sign-Off') {
    if (actor.role !== 'REVIEWER' && actor.role !== 'ADMIN') {
      return { allowed: false, reason: 'Only a Reviewer may record reviewer sign-off.' };
    }
    if (actor.id === project.owner_id) {
      return { allowed: false, reason: 'Separation of duties: a reviewer cannot sign off a project they own.' };
    }
    const requesterMatch = approvedActiveExceptions.some((e) => e.requester_id === actor.id);
    if (requesterMatch) {
      return {
        allowed: false,
        reason: 'Separation of duties: the exception requester cannot sign off the project.',
      };
    }
    const allEffectiveGatesSatisfied = assessment.stageSummaries.every((s) => s.effectiveGs === 1);
    if (!allEffectiveGatesSatisfied) {
      return {
        allowed: false,
        reason: 'Cannot record reviewer sign-off while an effective stage gate remains open.',
      };
    }
    if (assessment.highRiskOpenCount > 0) {
      return {
        allowed: false,
        reason:
          'Cannot record reviewer sign-off while a residual High risk remains open (must be mitigated or formally accepted by Risk Acceptance Authority).',
      };
    }
    return { allowed: true, reason: 'Reviewer sign-off criteria satisfied.' };
  }

  if (targetState === 'Cleared for Controlled Release') {
    if (actor.role !== 'REVIEWER' && actor.role !== 'ADMIN') {
      return { allowed: false, reason: 'Only a Reviewer or Admin may finalize controlled release clearance after sign-off.' };
    }
    if (actor.id === project.owner_id) {
      return { allowed: false, reason: 'Project owner cannot clear their own project for release.' };
    }
    if (current !== 'Reviewer Sign-Off') {
      return { allowed: false, reason: 'Project must have Reviewer Sign-Off before Cleared for Controlled Release.' };
    }
    const allEffectiveGatesSatisfied = assessment.stageSummaries.every((s) => s.effectiveGs === 1);
    if (!allEffectiveGatesSatisfied) {
      return { allowed: false, reason: 'All effective gates must be satisfied.' };
    }
    if (assessment.highRiskOpenCount > 0) {
      return { allowed: false, reason: 'No residual High risk may remain open.' };
    }
    if (expiredExceptions.length > 0 || expiredAcceptances.length > 0) {
      return {
        allowed: false,
        reason: 'Release blocked: project has expired exceptions or expired formal risk acceptances.',
      };
    }
    return { allowed: true, reason: 'All release conditions satisfied.' };
  }

  // Returning to Draft
  return { allowed: true, reason: 'Returned to Draft for reassessment or remediation.' };
}

export function validateFormalRiskAcceptance(params: {
  riskId: string;
  project: ProjectRecord;
  actor: UserRecord;
  rationale: string;
  scope: string;
  expiryDate: string;
  exceptions: ExceptionRecord[];
}): string | null {
  if (params.actor.role !== 'RISK_ACCEPTANCE_AUTHORITY') {
    return 'Forbidden: only the RISK_ACCEPTANCE_AUTHORITY role can formally accept risks.';
  }
  if (params.actor.id === params.project.owner_id) {
    return 'Separation of duties: the approver cannot be the project owner.';
  }
  const requestedAny = params.exceptions.some((e) => e.requester_id === params.actor.id);
  if (requestedAny) {
    return 'Separation of duties: the approver cannot be an exception requester on this project.';
  }
  const risk = RISKS.find((r) => r.id === params.riskId);
  if (!risk) {
    return `Unknown risk ID "${params.riskId}".`;
  }
  if (!risk.acceptableUnderPolicy) {
    return `Risk "${risk.name}" has acceptable_under_policy = false and cannot be formally accepted by anyone.`;
  }
  if (!params.rationale || params.rationale.trim().length < 10) {
    return 'Written rationale (at least 10 characters) is mandatory.';
  }
  if (!params.scope || params.scope.trim().length < 5) {
    return 'Explicit scope describing what exactly is accepted is mandatory.';
  }
  if (!params.expiryDate || Number.isNaN(Date.parse(params.expiryDate))) {
    return 'A valid mandatory expiry or review date is required.';
  }
  if (new Date(params.expiryDate).getTime() <= Date.now()) {
    return 'Expiry or review date must be in the future.';
  }
  return null;
}

export async function loadProjectAssessmentContext(db: DbClient, projectId: string) {
  const project = await db.get<ProjectRecord>(
    `SELECT p.*, uo.full_name as owner_name, uo.email as owner_email,
            ur.full_name as reviewer_name, ur.email as reviewer_email
     FROM projects p
     JOIN users uo ON p.owner_id = uo.id
     JOIN users ur ON p.assigned_reviewer_id = ur.id
     WHERE p.id = ?`,
    [projectId]
  );
  if (!project) return null;

  // Normalize booleans across SQLite (0/1) and PostgreSQL (true/false)
  const normProject: ProjectRecord = {
    ...project,
    affects_academic_standing: Boolean(project.affects_academic_standing),
    uses_synthetic_data: Boolean(project.uses_synthetic_data),
    uses_third_party_wrapper: Boolean(project.uses_third_party_wrapper),
    is_low_risk_admin_script: Boolean(project.is_low_risk_admin_script),
    is_demo: Boolean(project.is_demo),
  };

  const evidence = await db.query<EvidenceRecord>(
    `SELECT * FROM project_evidence WHERE project_id = ?`,
    [projectId]
  );
  const fcRow = await db.get<{
    project_id: string;
    metric_name: string;
    cohorts_json: string;
    max_gap: number | null;
    tolerance_used: number;
    passed: number | boolean;
    checked_at: string;
  }>(`SELECT * FROM fairness_checks WHERE project_id = ?`, [projectId]);

  const fairnessCheck: FairnessCheckRecord | null = fcRow
    ? {
        project_id: fcRow.project_id,
        metric_name: fcRow.metric_name,
        cohorts: JSON.parse(fcRow.cohorts_json),
        max_gap: fcRow.max_gap,
        tolerance_used: fcRow.tolerance_used,
        passed: Boolean(fcRow.passed),
        checked_at: fcRow.checked_at,
      }
    : null;

  const exceptions = (
    await db.query<ExceptionRecord>(
      `SELECT e.*, ur.full_name as requester_name, uv.full_name as reviewer_name
       FROM exceptions e
       JOIN users ur ON e.requester_id = ur.id
       LEFT JOIN users uv ON e.reviewer_id = uv.id
       WHERE e.project_id = ?
       ORDER BY e.created_at DESC`,
      [projectId]
    )
  ).map((e) => ({ ...e, is_demo: Boolean(e.is_demo) }));

  const riskAcceptances = (
    await db.query<RiskAcceptanceRecord>(
      `SELECT ra.*, ua.full_name as approver_name
       FROM risk_acceptances ra
       JOIN users ua ON ra.approver_id = ua.id
       WHERE ra.project_id = ?
       ORDER BY ra.created_at DESC`,
      [projectId]
    )
  ).map((a) => ({ ...a, is_demo: Boolean(a.is_demo) }));

  const rulesRaw = await db.query<{
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

  const rules: RuleDefinition[] = rulesRaw.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    priority: r.priority,
    stage: r.stage,
    severity: r.severity,
    supported_governance_req: r.supported_governance_req,
    condition_summary: r.condition_summary,
    action_summary: r.action_summary,
    dependencies: JSON.parse(r.dependencies_json),
    enabled: Boolean(r.enabled),
    updated_at: r.updated_at,
  }));

  const clausesRaw = await db.query<{
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

  const clauses: PolicyClause[] = clausesRaw.map((c) => ({
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
  }));

  const settings = await db.get<SystemSettings>(`SELECT * FROM settings WHERE id = 1`);
  if (!settings) {
    throw new Error('System settings row missing.');
  }

  return {
    project: normProject,
    evidence,
    fairnessCheck,
    exceptions,
    riskAcceptances,
    rules,
    clauses,
    settings,
  };
}

export async function runAndPersistAssessment(
  db: DbClient,
  projectId: string,
  triggeredByUser: UserRecord | null,
  sourceIp = '127.0.0.1'
): Promise<AssessmentResult | null> {
  await checkAndExpireApprovals(db, projectId);
  const ctx = await loadProjectAssessmentContext(db, projectId);
  if (!ctx) return null;

  const result = runForwardChainingAssessment(ctx);

  // Sync workflow_state automatically if an active release/pass is invalidated by missing/expired evidence
  let updatedState = ctx.project.workflow_state;
  if (
    updatedState === 'Cleared for Controlled Release' &&
    (result.releaseLocked || result.highRiskOpenCount > 0)
  ) {
    updatedState = 'Draft';
    await db.execute(`UPDATE projects SET workflow_state = ?, updated_at = ? WHERE id = ?`, [
      updatedState,
      new Date().toISOString(),
      projectId,
    ]);
    await appendAuditLog(db, {
      userId: triggeredByUser?.id ?? null,
      userEmail: triggeredByUser?.email ?? 'system@scheduler',
      userRole: triggeredByUser?.role ?? 'SYSTEM',
      action: 'WORKFLOW_AUTO_REOPEN',
      projectId,
      details: `Project returned to Draft automatically because a gate or high-risk item became open (${result.releaseLockedReasons[0] ?? 'reassessment'}).`,
      sourceIp,
      isDemo: ctx.project.is_demo,
    });
  } else if (
    updatedState === 'Draft' &&
    result.automatedCheckPassed &&
    !result.reliesOnException
  ) {
    updatedState = 'Automated Check Passed';
    await db.execute(`UPDATE projects SET workflow_state = ?, updated_at = ? WHERE id = ?`, [
      updatedState,
      new Date().toISOString(),
      projectId,
    ]);
  }

  await db.execute(
    `INSERT INTO assessment_runs (id, project_id, triggered_by, result_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      result.runId,
      projectId,
      triggeredByUser?.id ?? 'system',
      JSON.stringify(result),
      result.evaluatedAt,
    ]
  );

  await appendAuditLog(db, {
    userId: triggeredByUser?.id ?? null,
    userEmail: triggeredByUser?.email ?? 'system@scheduler',
    userRole: triggeredByUser?.role ?? 'SYSTEM',
    action: 'ASSESSMENT_RUN',
    projectId,
    details: `Run ${result.runId}: readiness ${(result.overallReadiness * 100).toFixed(0)}%, status "${result.releaseStatusBanner}", fired rules: ${result.firedRules.map((f) => f.ruleId).join(', ') || 'none'}.`,
    sourceIp,
    isDemo: ctx.project.is_demo,
  });

  return result;
}

export async function checkAndExpireApprovals(
  db: DbClient,
  onlyProjectId?: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  let expiredCount = 0;

  const exQuery = onlyProjectId
    ? `SELECT * FROM exceptions WHERE status = 'Approved' AND project_id = ?`
    : `SELECT * FROM exceptions WHERE status = 'Approved'`;
  const approvedExceptions = await db.query<ExceptionRecord>(
    exQuery,
    onlyProjectId ? [onlyProjectId] : []
  );

  for (const ex of approvedExceptions) {
    if (new Date(ex.expiry_date).getTime() < Date.now()) {
      await db.execute(`UPDATE exceptions SET status = 'Expired' WHERE id = ?`, [ex.id]);
      await appendAuditLog(db, {
        userId: null,
        userEmail: 'system@scheduler',
        userRole: 'SYSTEM',
        action: 'EXCEPTION_EXPIRED',
        projectId: ex.project_id,
        details: `Exception ${ex.id} for ${ex.target_type} "${ex.target_id}" expired at ${ex.expiry_date}; blocker re-opened.`,
        expiryDate: ex.expiry_date,
        sourceIp: '127.0.0.1',
        isDemo: Boolean(ex.is_demo),
      });
      // Revert workflow if it relied on exception
      await db.execute(
        `UPDATE projects SET workflow_state = 'Draft', updated_at = ?
         WHERE id = ? AND workflow_state IN ('Exception-Based Review Eligible', 'Reviewer Sign-Off', 'Cleared for Controlled Release')`,
        [nowIso, ex.project_id]
      );
      expiredCount += 1;
    }
  }

  const accQuery = onlyProjectId
    ? `SELECT * FROM risk_acceptances WHERE status = 'Active' AND project_id = ?`
    : `SELECT * FROM risk_acceptances WHERE status = 'Active'`;
  const activeAcceptances = await db.query<RiskAcceptanceRecord>(
    accQuery,
    onlyProjectId ? [onlyProjectId] : []
  );

  for (const acc of activeAcceptances) {
    if (new Date(acc.expiry_date).getTime() < Date.now()) {
      await db.execute(`UPDATE risk_acceptances SET status = 'Expired' WHERE id = ?`, [acc.id]);
      await appendAuditLog(db, {
        userId: null,
        userEmail: 'system@scheduler',
        userRole: 'SYSTEM',
        action: 'RISK_ACCEPTANCE_EXPIRED',
        projectId: acc.project_id,
        details: `Formal risk acceptance ${acc.id} for ${acc.risk_id} expired at ${acc.expiry_date}; risk re-opened.`,
        expiryDate: acc.expiry_date,
        sourceIp: '127.0.0.1',
        isDemo: Boolean(acc.is_demo),
      });
      await db.execute(
        `UPDATE projects SET workflow_state = 'Draft', updated_at = ?
         WHERE id = ? AND workflow_state IN ('Reviewer Sign-Off', 'Cleared for Controlled Release')`,
        [nowIso, acc.project_id]
      );
      expiredCount += 1;
    }
  }

  return expiredCount;
}
