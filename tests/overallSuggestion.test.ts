import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOverallSuggestion } from '../src/utils/overallSuggestion';
import { AssessmentResult, EvidenceItem, FairnessCheck, ProjectItem, SystemSettings } from '../src/types';

const baseSettings: SystemSettings = {
  missingness_threshold: 0.05,
  parity_tolerance: 0.05,
  readiness_threshold: 0.75,
  retrieval_high_threshold: 0.55,
  retrieval_medium_threshold: 0.25,
  hybrid_weight: 0.55,
  bm25_k1: 1.5,
  bm25_b: 0.75,
};

function makeProject(workflow_state: ProjectItem['workflow_state']): ProjectItem {
  return {
    id: 'proj-1',
    name: 'Test Project',
    description: 'Description',
    owner_id: 'u-1',
    assigned_reviewer_id: 'u-2',
    deployment_autonomy: 'advisory',
    affects_academic_standing: false,
    data_sensitivity: 'medium',
    uses_synthetic_data: false,
    uses_third_party_wrapper: false,
    is_low_risk_admin_script: false,
    target_user_population: 'Students',
    workflow_state,
    is_demo: false,
    created_at: '2026-11-19T00:00:00.000Z',
    updated_at: '2026-11-19T00:00:00.000Z',
  };
}

function makeAssessment(overrides: Partial<AssessmentResult> = {}): AssessmentResult {
  return {
    runId: 'run-1',
    projectId: 'proj-1',
    evaluatedAt: '2026-11-19T00:00:00.000Z',
    overallReadiness: 0,
    readinessLabel: 'Not started',
    releaseStatusBanner: 'NOT READY: Required stage gate locked',
    releaseStatusSentence: 'At least one mandatory lifecycle item is missing, expired, or unverified.',
    releaseLocked: true,
    releaseLockedReasons: [],
    automatedCheckPassed: false,
    reliesOnException: false,
    highRiskOpenCount: 1,
    openRiskCount: 2,
    stagesCompleteCount: 0,
    stageSummaries: [
      {
        stage: 1,
        name: 'Data Governance',
        focus: 'Privacy',
        rs: 0,
        gs: 0,
        effectiveGs: 0,
        scoreHighButGateLocked: false,
        statusWord: 'Not started',
        verifiedCount: 0,
        totalCount: 2,
        blockingVerifiedCount: 0,
        blockingTotalCount: 2,
        artefactDetails: [
          {
            artefactId: 'dataset_datasheet',
            name: 'Dataset Datasheet',
            weight: 0.5,
            isBlocking: true,
            rawStatus: 'Not submitted',
            classification: 'Not submitted',
            inDate: false,
            expiryDate: null,
            coveredByExceptionId: null,
            whyItMatters: 'Documents dataset composition.',
          },
          {
            artefactId: 'consent_record',
            name: 'Consent Record',
            weight: 0.5,
            isBlocking: true,
            rawStatus: 'Not submitted',
            classification: 'Not submitted',
            inDate: false,
            expiryDate: null,
            coveredByExceptionId: null,
            whyItMatters: 'Verifies consent.',
          },
        ],
      },
    ],
    riskSummaries: [],
    firedRules: [],
    derivedFacts: [],
    conflicts: [],
    guidanceItems: [],
    nextActions: [],
    expiredNotices: [],
    ...overrides,
  };
}

test('buildOverallSuggestion guides starter project toward missing blocking items', () => {
  const suggestion = buildOverallSuggestion({
    assessment: makeAssessment(),
    settings: baseSettings,
  });

  assert.equal(suggestion.tone, 'blocked');
  assert.match(suggestion.headline, /Not ready yet \(0% ready\)/);
  assert.equal(suggestion.counts.blockingRemaining, 2);
  assert.ok(suggestion.steps.some((s) => s.targetTab === 'evidence' && /Dataset Datasheet/.test(s.description)));
});

test('buildOverallSuggestion highlights submitted items awaiting reviewer verification', () => {
  const assessment = makeAssessment();
  assessment.stageSummaries[0].artefactDetails[0].rawStatus = 'Submitted';
  assessment.stageSummaries[0].artefactDetails[0].classification = 'Submitted but unverified';
  assessment.stageSummaries[0].artefactDetails[1].rawStatus = 'Submitted';
  assessment.stageSummaries[0].artefactDetails[1].classification = 'Submitted but unverified';

  const suggestion = buildOverallSuggestion({
    assessment,
    settings: baseSettings,
  });

  assert.equal(suggestion.tone, 'blocked');
  assert.match(suggestion.headline, /waiting for a Reviewer to mark them Verified/i);
  assert.ok(suggestion.steps.some((s) => /Verify 2 submitted blocking items/i.test(s.title)));
});

test('buildOverallSuggestion surfaces missingness and fairness threshold failures clearly', () => {
  const evidence: EvidenceItem[] = [
    {
      id: 'ev-1',
      project_id: 'proj-1',
      artefact_id: 'schema_profile',
      status: 'Submitted',
      notes: '',
      file_name: null,
      file_size: null,
      file_checksum: null,
      external_link: null,
      expiry_date: null,
      missingness_pct: 0.12,
      updated_at: '2026-11-19T00:00:00.000Z',
    },
  ];
  const fairnessCheck: FairnessCheck = {
    project_id: 'proj-1',
    metric_name: 'Accuracy',
    cohorts: [
      { cohort: 'A', metricName: 'Accuracy', value: 0.92 },
      { cohort: 'B', metricName: 'Accuracy', value: 0.8 },
    ],
    max_gap: 0.12,
    tolerance_used: 0.05,
    passed: false,
    checked_at: '2026-11-19T00:00:00.000Z',
  };

  const suggestion = buildOverallSuggestion({
    assessment: makeAssessment(),
    evidence,
    fairnessCheck,
    settings: baseSettings,
  });

  assert.ok(suggestion.steps.some((s) => /12\.0%/.test(s.description) && /5\.0%/.test(s.title)));
  assert.ok(suggestion.steps.some((s) => /fairness gap/i.test(s.title) && /12\.0%/.test(s.description)));
});

test('buildOverallSuggestion points to review sign-off when gates pass and export when cleared', () => {
  const passing = makeAssessment({
    overallReadiness: 0.9,
    releaseLocked: false,
    highRiskOpenCount: 0,
    releaseStatusBanner: 'NEEDS REVIEW',
  });
  passing.stageSummaries[0].artefactDetails.forEach((d) => {
    d.rawStatus = 'Verified';
    d.classification = 'Verified';
    d.inDate = true;
  });

  const needsSignOff = buildOverallSuggestion({
    assessment: passing,
    project: makeProject('Automated Check Passed'),
    settings: baseSettings,
  });
  assert.equal(needsSignOff.tone, 'attention');
  assert.equal(needsSignOff.steps[0].targetTab, 'review');

  const cleared = buildOverallSuggestion({
    assessment: { ...passing, releaseStatusBanner: 'READY FOR CONTROLLED RELEASE' },
    project: makeProject('Cleared for Controlled Release'),
    settings: baseSettings,
  });
  assert.equal(cleared.tone, 'ready');
  assert.equal(cleared.steps[0].targetTab, 'export');
});
