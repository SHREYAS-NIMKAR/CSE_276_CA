import crypto from 'crypto';
import { appendAuditLog } from './audit';
import { DbClient } from './db';
import { ARTEFACTS } from './knowledge';
import { UserRecord } from './types';
import { runAndPersistAssessment } from './workflow';

export type SampleProjectKey = 'ready' | 'needs_fixes' | 'exception';

interface SampleSpec {
  key: SampleProjectKey;
  name: string;
  description: string;
  deployment_autonomy: 'advisory' | 'automated_action';
  affects_academic_standing: boolean;
  data_sensitivity: 'low' | 'medium' | 'high';
  uses_synthetic_data: boolean;
  uses_third_party_wrapper: boolean;
  is_low_risk_admin_script: boolean;
  target_user_population: string;
  workflow_state: string;
}

const SAMPLE_SPECS: SampleSpec[] = [
  {
    key: 'ready',
    name: 'Study Planner Recommendation Assistant (Demo)',
    description:
      'Practice example of a cleared project: advisory course-scheduling helper with all 21 items verified, 1.4% missingness, and 1.8% fairness gap.',
    deployment_autonomy: 'advisory',
    affects_academic_standing: false,
    data_sensitivity: 'low',
    uses_synthetic_data: false,
    uses_third_party_wrapper: false,
    is_low_risk_admin_script: false,
    target_user_population: 'Undergraduate students and academic advisors',
    workflow_state: 'Cleared for Controlled Release',
  },
  {
    key: 'needs_fixes',
    name: 'Scholarship Essay Screener (Demo — Needs Fixes)',
    description:
      'Practice example with realistic issues to repair: 9.2% dataset missingness, 11.0% subgroup fairness gap, expired ethics approval, and missing blocking files.',
    deployment_autonomy: 'automated_action',
    affects_academic_standing: true,
    data_sensitivity: 'high',
    uses_synthetic_data: false,
    uses_third_party_wrapper: false,
    is_low_risk_admin_script: false,
    target_user_population: 'Scholarship applicants across domestic and international cohorts',
    workflow_state: 'Draft',
  },
  {
    key: 'exception',
    name: 'Campus FAQ Chatbot Wrapper (Demo — Exception Flow)',
    description:
      'Practice example of a third-party language model wrapper using synthetic dialogue data with a pending governance exception for raw training provenance.',
    deployment_autonomy: 'advisory',
    affects_academic_standing: false,
    data_sensitivity: 'low',
    uses_synthetic_data: true,
    uses_third_party_wrapper: true,
    is_low_risk_admin_script: false,
    target_user_population: 'Incoming students and advising desk',
    workflow_state: 'Exception Requested',
  },
];

export async function loadBeginnerSampleProjects(
  db: DbClient,
  actor: UserRecord,
  requestedKey: SampleProjectKey | 'all',
  sourceIp: string
): Promise<{
  createdCount: number;
  projectIds: string[];
  primaryProjectId: string;
}> {
  const specs =
    requestedKey === 'all'
      ? SAMPLE_SPECS
      : SAMPLE_SPECS.filter((s) => s.key === requestedKey);

  // Choose an active dedicated REVIEWER different from the actor when available;
  // otherwise fall back to an active ADMIN (or the actor themselves in solo-admin setups).
  const dedicatedReviewer = await db.get<UserRecord>(
    `SELECT * FROM users WHERE role = 'REVIEWER' AND is_active = ? AND id != ? ORDER BY is_demo ASC, created_at ASC LIMIT 1`,
    [db.isPostgres ? true : 1, actor.id]
  );
  const fallbackAdmin =
    dedicatedReviewer ??
    (await db.get<UserRecord>(
      `SELECT * FROM users WHERE role = 'ADMIN' AND is_active = ? ORDER BY created_at ASC LIMIT 1`,
      [db.isPostgres ? true : 1]
    )) ??
    actor;

  const dbBool = (val: boolean) => (db.isPostgres ? val : val ? 1 : 0);
  const now = new Date().toISOString();
  const futureExpiry = new Date(Date.now() + 180 * 86400 * 1000).toISOString();
  const pastExpiry = new Date(Date.now() - 12 * 86400 * 1000).toISOString();

  const projectIds: string[] = [];
  let createdCount = 0;

  for (const spec of specs) {
    const existing = await db.get<{ id: string }>(
      `SELECT id FROM projects WHERE owner_id = ? AND name = ? AND is_demo = ? LIMIT 1`,
      [actor.id, spec.name, dbBool(true)]
    );
    if (existing) {
      projectIds.push(existing.id);
      continue;
    }

    const projId = `proj-sample-${spec.key}-${crypto.randomBytes(3).toString('hex')}`;
    await db.execute(
      `INSERT INTO projects (
        id, name, description, owner_id, assigned_reviewer_id, deployment_autonomy,
        affects_academic_standing, data_sensitivity, uses_synthetic_data,
        uses_third_party_wrapper, is_low_risk_admin_script, target_user_population,
        workflow_state, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projId,
        spec.name,
        spec.description,
        actor.id,
        fallbackAdmin.id,
        spec.deployment_autonomy,
        dbBool(spec.affects_academic_standing),
        spec.data_sensitivity,
        dbBool(spec.uses_synthetic_data),
        dbBool(spec.uses_third_party_wrapper),
        dbBool(spec.is_low_risk_admin_script),
        spec.target_user_population,
        spec.workflow_state,
        dbBool(true),
        now,
        now,
      ]
    );

    // Populate evidence tailored to each learning scenario
    for (const art of ARTEFACTS) {
      let status = 'Verified';
      let notes = `Sample verified evidence for ${art.name}.`;
      let externalLink: string | null = `https://example.edu/governance-samples/${spec.key}/${art.id}.pdf`;
      let expiryDate: string | null = art.id === 'ethics_board_signoff' ? futureExpiry : null;
      let missingnessPct: number | null = art.id === 'schema_profile' ? 0.014 : null;

      if (spec.key === 'needs_fixes') {
        if (art.id === 'schema_profile') {
          missingnessPct = 0.092;
          notes = 'Sample dataset schema shows 9.2% missing values across optional essay prompts (exceeds 5.0% limit).';
        } else if (art.id === 'subgroup_error_matrix') {
          status = 'Not submitted';
          notes = 'Only overall accuracy (85%) recorded so far; per-cohort breakdown missing.';
          externalLink = null;
        } else if (art.id === 'rollback_plan') {
          status = 'Not submitted';
          notes = '';
          externalLink = null;
        } else if (art.id === 'ethics_board_signoff') {
          status = 'Verified';
          expiryDate = pastExpiry;
          notes = 'Prior pilot approval expired 12 days ago; needs renewal.';
        } else if (art.id === 'global_feature_attribution') {
          status = 'Submitted';
          notes = 'Draft feature importance chart uploaded, waiting for reviewer verification.';
        }
      } else if (spec.key === 'exception') {
        if (art.id === 'schema_profile') {
          missingnessPct = 0.02;
        } else if (art.id === 'provenance_log') {
          status = 'Submitted';
          notes = 'Prompt templates documented; upstream vendor weights are proprietary.';
        } else if (art.id === 'architecture_rationale') {
          status = 'Submitted';
          notes = 'Wrapper API safety guardrails documented; awaiting reviewer verification.';
        } else if (art.id === 'local_explanation_examples') {
          status = 'Unclear';
          notes = 'Sample replies attached, needs clearer handbook citation links.';
        }
      }

      await db.execute(
        `INSERT INTO project_evidence (
          id, project_id, artefact_id, status, notes, external_link, expiry_date, missingness_pct, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `ev-${projId}-${art.id}`,
          projId,
          art.id,
          status,
          notes,
          externalLink,
          expiryDate,
          missingnessPct,
          actor.id,
          now,
        ]
      );
    }

    // Seed fairness parity checks
    if (spec.key === 'ready') {
      await db.execute(
        `INSERT INTO fairness_checks (project_id, metric_name, cohorts_json, max_gap, tolerance_used, passed, checked_at)
         VALUES (?, 'F1 Score', ?, 0.018, 0.05, ?, ?)`,
        [
          projId,
          JSON.stringify([
            { cohort: 'Domestic Students', metricName: 'F1 Score', value: 0.912 },
            { cohort: 'International Students', metricName: 'F1 Score', value: 0.894 },
          ]),
          dbBool(true),
          now,
        ]
      );
      await db.execute(
        `INSERT INTO review_comments (id, project_id, author_id, comment, action_type, is_demo, created_at)
         VALUES (?, ?, ?, ?, 'SIGN_OFF', ?, ?)`,
        [
          `rc-${crypto.randomBytes(4).toString('hex')}`,
          projId,
          fallbackAdmin.id,
          'Beginner example: all 21 items verified and fairness gap (1.8%) is within the 5% limit.',
          dbBool(true),
          now,
        ]
      );
    } else if (spec.key === 'needs_fixes') {
      await db.execute(
        `INSERT INTO fairness_checks (project_id, metric_name, cohorts_json, max_gap, tolerance_used, passed, checked_at)
         VALUES (?, 'Accuracy', ?, 0.11, 0.05, ?, ?)`,
        [
          projId,
          JSON.stringify([
            { cohort: 'Native English Writers', metricName: 'Accuracy', value: 0.89 },
            { cohort: 'Multilingual Writers', metricName: 'Accuracy', value: 0.78 },
          ]),
          dbBool(false),
          now,
        ]
      );
    } else if (spec.key === 'exception') {
      await db.execute(
        `INSERT INTO fairness_checks (project_id, metric_name, cohorts_json, max_gap, tolerance_used, passed, checked_at)
         VALUES (?, 'Answer Relevance', ?, 0.031, 0.05, ?, ?)`,
        [
          projId,
          JSON.stringify([
            { cohort: 'First-Year Students', metricName: 'Answer Relevance', value: 0.871 },
            { cohort: 'Transfer Students', metricName: 'Answer Relevance', value: 0.840 },
          ]),
          dbBool(true),
          now,
        ]
      );
      await db.execute(
        `INSERT INTO exceptions (
          id, project_id, requester_id, target_type, target_id, rationale, expiry_date, status, is_demo, created_at
        ) VALUES (?, ?, ?, 'artefact', 'provenance_log', ?, ?, 'Pending', ?, ?)`,
        [
          `EX-SAMPLE-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          projId,
          actor.id,
          'External foundation model API provider does not disclose raw pretraining corpus lineage; local prompt safety logs are provided instead.',
          futureExpiry,
          dbBool(true),
          now,
        ]
      );
    }

    await runAndPersistAssessment(db, projId, actor, sourceIp);
    projectIds.push(projId);
    createdCount += 1;
  }

  if (createdCount > 0) {
    await appendAuditLog(db, {
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'SAMPLE_PROJECTS_LOADED',
      projectId: projectIds[0] ?? null,
      details: `Loaded ${createdCount} beginner practice demo project(s) (${requestedKey}).`,
      sourceIp,
      isDemo: true,
    });
  }

  return {
    createdCount,
    projectIds,
    primaryProjectId: projectIds[0] ?? '',
  };
}
