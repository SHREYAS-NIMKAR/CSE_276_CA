import {
  ArtefactDefinition,
  GovernanceRequirementDefinition,
  ProjectRecord,
  RiskDefinition,
  StageDefinition,
  AssessmentResult,
} from './types';

export const STAGES: StageDefinition[] = [
  {
    stage: 1,
    id: 'STAGE_1',
    name: 'Data Governance',
    focus: 'Privacy, lineage, representativeness',
    acceptanceCriteria:
      'Zero unresolved PII leaks; documented sampling frame; missingness below configurable threshold.',
  },
  {
    stage: 2,
    id: 'STAGE_2',
    name: 'Model Selection',
    focus: 'Proportionality and scientific rigour',
    acceptanceCriteria:
      'Demonstrated gain over an interpretable baseline; documented compute and latency bounds.',
  },
  {
    stage: 3,
    id: 'STAGE_3',
    name: 'Testing and Validation',
    focus: 'Robustness and empirical fairness',
    acceptanceCriteria:
      'Performance parity within configurable tolerance across protected cohorts; boundary behaviour verified.',
  },
  {
    stage: 4,
    id: 'STAGE_4',
    name: 'Explainability',
    focus: 'Transparency and contestability',
    acceptanceCriteria:
      'Stakeholder-readable rationale verified for high-impact outputs; uncertainty exposed.',
  },
  {
    stage: 5,
    id: 'STAGE_5',
    name: 'Deployment Readiness',
    focus: 'Operational safety and reliability',
    acceptanceCriteria:
      'Alert thresholds active; staging load test passed; human fallback defined.',
  },
  {
    stage: 6,
    id: 'STAGE_6',
    name: 'Responsible-Use Evidence',
    focus: 'Accountability and compliance',
    acceptanceCriteria:
      'All high-severity risks mitigated, formally accepted by the Risk Acceptance Authority, or covered by a documented institutional exception.',
  },
];

export const ARTEFACTS: ArtefactDefinition[] = [
  // Stage 1: weights sum to 0.35 + 0.25 + 0.25 + 0.15 = 1.00
  {
    id: 'dataset_datasheet',
    name: 'Dataset Datasheet',
    stage: 1,
    weight: 0.35,
    isBlocking: true,
    whyItMatters: 'Documents dataset composition, collection context, intended scope, and sensitive fields.',
    reducesRisks: ['RISK_PII_LEAK', 'RISK_SAMPLING_BIAS'],
  },
  {
    id: 'provenance_log',
    name: 'Provenance Log',
    stage: 1,
    weight: 0.25,
    isBlocking: false,
    whyItMatters: 'Traces where training and evaluation records came from and any transformations applied.',
    reducesRisks: ['RISK_UNTRACED_LINEAGE'],
  },
  {
    id: 'consent_record',
    name: 'Consent Record',
    stage: 1,
    weight: 0.25,
    isBlocking: true,
    whyItMatters: 'Verifies lawful institutional permission and student/data-subject consent or opt-out scope.',
    reducesRisks: ['RISK_PII_LEAK', 'RISK_CONSENT_VIOLATION'],
  },
  {
    id: 'schema_profile',
    name: 'Schema Profile',
    stage: 1,
    weight: 0.15,
    isBlocking: false,
    whyItMatters: 'Quantifies missing values, valid ranges, and PII column screening before modelling.',
    reducesRisks: ['RISK_DATA_QUALITY', 'RISK_SAMPLING_BIAS'],
  },

  // Stage 2: weights sum to 0.35 + 0.40 + 0.25 = 1.00
  {
    id: 'architecture_rationale',
    name: 'Architecture Rationale',
    stage: 2,
    weight: 0.35,
    isBlocking: false,
    whyItMatters: 'Explains why the selected model family fits the educational task without unnecessary opacity.',
    reducesRisks: ['RISK_UNJUSTIFIED_COMPLEXITY'],
  },
  {
    id: 'baseline_benchmark',
    name: 'Baseline Benchmark',
    stage: 2,
    weight: 0.40,
    isBlocking: true,
    whyItMatters: 'Proves the proposed model outperforms a simpler interpretable baseline on the same task.',
    reducesRisks: ['RISK_UNJUSTIFIED_COMPLEXITY'],
  },
  {
    id: 'complexity_justification',
    name: 'Complexity Justification',
    stage: 2,
    weight: 0.25,
    isBlocking: false,
    whyItMatters: 'Records compute, memory, and latency bounds so deployment stays within university budgets.',
    reducesRisks: ['RISK_UNBOUNDED_COMPUTE'],
  },

  // Stage 3: weights sum to 0.30 + 0.45 + 0.25 = 1.00
  {
    id: 'stratified_test_report',
    name: 'Stratified Test Report',
    stage: 3,
    weight: 0.30,
    isBlocking: true,
    whyItMatters: 'Reports evaluation metrics across relevant student cohorts rather than only aggregate accuracy.',
    reducesRisks: ['RISK_SUBGROUP_PARITY'],
  },
  {
    id: 'subgroup_error_matrix',
    name: 'Subgroup Error Matrix',
    stage: 3,
    weight: 0.45,
    isBlocking: true,
    whyItMatters: 'Compares error rates across protected groups to prevent disparate impact on student standing.',
    reducesRisks: ['RISK_SUBGROUP_PARITY'],
  },
  {
    id: 'stress_test_log',
    name: 'Stress-Test Log',
    stage: 3,
    weight: 0.25,
    isBlocking: false,
    whyItMatters: 'Checks out-of-distribution inputs, edge cases, and adversarial formatting failures.',
    reducesRisks: ['RISK_BOUNDARY_FAILURE'],
  },

  // Stage 4: weights sum to 0.35 + 0.40 + 0.25 = 1.00
  {
    id: 'global_feature_attribution',
    name: 'Global Feature Attribution',
    stage: 4,
    weight: 0.35,
    isBlocking: false,
    whyItMatters: 'Shows which variables drive model predictions overall so faculty can audit decision logic.',
    reducesRisks: ['RISK_CONTESTABILITY_GAP'],
  },
  {
    id: 'local_explanation_examples',
    name: 'Local Explanation Examples',
    stage: 4,
    weight: 0.40,
    isBlocking: false,
    whyItMatters: 'Provides plain-language case explanations so affected students can understand and appeal outcomes.',
    reducesRisks: ['RISK_CONTESTABILITY_GAP'],
  },
  {
    id: 'limitation_note',
    name: 'Limitation Note',
    stage: 4,
    weight: 0.25,
    isBlocking: false,
    whyItMatters: 'Communicates known failure modes, confidence bounds, and when human judgement must take over.',
    reducesRisks: ['RISK_OVERTRUST_UNCERTAINTY'],
  },

  // Stage 5: weights sum to 0.35 + 0.25 + 0.20 + 0.20 = 1.00
  {
    id: 'rollback_plan',
    name: 'Rollback Plan',
    stage: 5,
    weight: 0.35,
    isBlocking: true,
    whyItMatters: 'Defines immediate steps and human fallback procedures to disable an automated system safely.',
    reducesRisks: ['RISK_UNSAFE_AUTOMATION'],
  },
  {
    id: 'drift_monitor_config',
    name: 'Drift Monitor Config',
    stage: 5,
    weight: 0.25,
    isBlocking: false,
    whyItMatters: 'Sets automated alerts when incoming student data or prediction distributions shift over time.',
    reducesRisks: ['RISK_SILENT_DRIFT'],
  },
  {
    id: 'access_control_policy',
    name: 'Access Control Policy',
    stage: 5,
    weight: 0.20,
    isBlocking: true,
    whyItMatters: 'Restricts who can invoke, retrain, or inspect outputs containing sensitive university data.',
    reducesRisks: ['RISK_UNAUTHORIZED_ACCESS'],
  },
  {
    id: 'sla_sheet',
    name: 'SLA Sheet',
    stage: 5,
    weight: 0.20,
    isBlocking: false,
    whyItMatters: 'Documents staging load-test results, uptime expectations, and incident response contacts.',
    reducesRisks: ['RISK_OPERATIONAL_OUTAGE'],
  },

  // Stage 6: weights sum to 0.25 + 0.25 + 0.35 + 0.15 = 1.00
  {
    id: 'model_card',
    name: 'Model Card',
    stage: 6,
    weight: 0.25,
    isBlocking: true,
    whyItMatters: 'Summarizes intended uses, out-of-scope uses, metrics, and limitations for governance boards.',
    reducesRisks: ['RISK_ACCOUNTABILITY_GAP'],
  },
  {
    id: 'misuse_assessment',
    name: 'Misuse Assessment',
    stage: 6,
    weight: 0.25,
    isBlocking: true,
    whyItMatters: 'Identifies foreseeable misuse or shortcut exploitation and documents concrete safeguards.',
    reducesRisks: ['RISK_FORESEEABLE_MISUSE'],
  },
  {
    id: 'ethics_board_signoff',
    name: 'Ethics Board Sign-Off',
    stage: 6,
    weight: 0.35,
    isBlocking: true,
    whyItMatters: 'Records time-bound institutional ethics approval before any student-facing deployment.',
    reducesRisks: ['RISK_MISSING_ETHICS_SIGNOFF'],
  },
  {
    id: 'user_notice',
    name: 'User Notice',
    stage: 6,
    weight: 0.15,
    isBlocking: false,
    whyItMatters: 'Informs students and staff when AI is used, what data it uses, and how to request human review.',
    reducesRisks: ['RISK_HIDDEN_AI_DISCLOSURE'],
  },
];

export const GOVERNANCE_REQUIREMENTS: GovernanceRequirementDefinition[] = [
  {
    id: 'GOV_REQ_1',
    title: 'Data Privacy, Consent & Lineage',
    description: 'Personal and academic records require verified consent, PII screening, and lineage documentation.',
    stage: 1,
  },
  {
    id: 'GOV_REQ_2',
    title: 'Proportional & Evidence-Based Modelling',
    description: 'Model complexity must be justified by empirical gains over an interpretable baseline.',
    stage: 2,
  },
  {
    id: 'GOV_REQ_3',
    title: 'Empirical Fairness & Robustness',
    description: 'Systems affecting students must demonstrate parity across protected cohorts within policy tolerance.',
    stage: 3,
  },
  {
    id: 'GOV_REQ_4',
    title: 'Explainability & Contestability',
    description: 'High-impact predictions must provide readable rationale and explicit uncertainty bounds.',
    stage: 4,
  },
  {
    id: 'GOV_REQ_5',
    title: 'Operational Safety & Human Fallback',
    description: 'Automated actions require tested rollback procedures, monitoring thresholds, and strict access controls.',
    stage: 5,
  },
  {
    id: 'GOV_REQ_6',
    title: 'Institutional Ethics & Public Accountability',
    description: 'Deployment requires current ethics board approval, model card disclosure, and misuse mitigation.',
    stage: 6,
  },
];

export const RISKS: RiskDefinition[] = [
  {
    id: 'RISK_PII_LEAK',
    name: 'Unresolved PII Exposure',
    description: 'Student personally identifiable information could be leaked in training or inference datasets.',
    severity: 'High',
    stage: 1,
    linkedGovernanceRequirement: 'GOV_REQ_1',
    acceptableUnderPolicy: false,
  },
  {
    id: 'RISK_CONSENT_VIOLATION',
    name: 'Missing Lawful Consent Basis',
    description: 'Dataset lacks verified consent or institutional authorization for the stated AI purpose.',
    severity: 'High',
    stage: 1,
    linkedGovernanceRequirement: 'GOV_REQ_1',
    acceptableUnderPolicy: false,
  },
  {
    id: 'RISK_UNTRACED_LINEAGE',
    name: 'Unverified Data Provenance',
    description: 'Origin and transformations of training or synthetic records are not documented.',
    severity: 'Medium',
    stage: 1,
    linkedGovernanceRequirement: 'GOV_REQ_1',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_SAMPLING_BIAS',
    name: 'Unrepresentative Sampling Frame',
    description: 'Dataset may omit key student cohorts or exhibit unmeasured skew.',
    severity: 'Medium',
    stage: 1,
    linkedGovernanceRequirement: 'GOV_REQ_1',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_DATA_QUALITY',
    name: 'Excessive Dataset Missingness',
    description: 'Missingness exceeds institutional quality tolerance, risking silent inference failures.',
    severity: 'Medium',
    stage: 1,
    linkedGovernanceRequirement: 'GOV_REQ_1',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_UNJUSTIFIED_COMPLEXITY',
    name: 'Unjustified Model Complexity',
    description: 'Model lacks benchmark proof that complexity improves over an interpretable baseline.',
    severity: 'Medium',
    stage: 2,
    linkedGovernanceRequirement: 'GOV_REQ_2',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_UNBOUNDED_COMPUTE',
    name: 'Unbounded Compute or Latency',
    description: 'Inference latency and resource requirements are undocumented for university infrastructure.',
    severity: 'Low',
    stage: 2,
    linkedGovernanceRequirement: 'GOV_REQ_2',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_SUBGROUP_PARITY',
    name: 'Unverified Subgroup Fairness Parity',
    description: 'Error rates across student demographic cohorts are missing or exceed parity tolerance.',
    severity: 'High',
    stage: 3,
    linkedGovernanceRequirement: 'GOV_REQ_3',
    acceptableUnderPolicy: false,
  },
  {
    id: 'RISK_BOUNDARY_FAILURE',
    name: 'Unchecked Boundary Behaviour',
    description: 'Model has not been stress-tested against out-of-distribution or edge inputs.',
    severity: 'Medium',
    stage: 3,
    linkedGovernanceRequirement: 'GOV_REQ_3',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_CONTESTABILITY_GAP',
    name: 'Opaque Outputs Without Contestability',
    description: 'Affected students or reviewers cannot inspect global or local reasons behind a prediction.',
    severity: 'Medium',
    stage: 4,
    linkedGovernanceRequirement: 'GOV_REQ_4',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_OVERTRUST_UNCERTAINTY',
    name: 'Uncommunicated Uncertainty & Limits',
    description: 'Users may over-rely on automated outputs because limitations and confidence bounds are missing.',
    severity: 'Low',
    stage: 4,
    linkedGovernanceRequirement: 'GOV_REQ_4',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_UNSAFE_AUTOMATION',
    name: 'Automated Action Without Rollback Plan',
    description: 'Automated deployment lacks a tested rollback and human fallback path if failures occur.',
    severity: 'High',
    stage: 5,
    linkedGovernanceRequirement: 'GOV_REQ_5',
    acceptableUnderPolicy: false,
  },
  {
    id: 'RISK_UNAUTHORIZED_ACCESS',
    name: 'Insufficient Access Control',
    description: 'Access boundaries for model endpoints, weights, or sensitive logs are unverified.',
    severity: 'High',
    stage: 5,
    linkedGovernanceRequirement: 'GOV_REQ_5',
    acceptableUnderPolicy: false,
  },
  {
    id: 'RISK_SILENT_DRIFT',
    name: 'Unmonitored Production Drift',
    description: 'Distribution shifts or accuracy degradation may go undetected after release.',
    severity: 'Medium',
    stage: 5,
    linkedGovernanceRequirement: 'GOV_REQ_5',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_OPERATIONAL_OUTAGE',
    name: 'Unverified Service Reliability',
    description: 'Staging load testing and SLA response commitments are incomplete.',
    severity: 'Low',
    stage: 5,
    linkedGovernanceRequirement: 'GOV_REQ_5',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_MISSING_ETHICS_SIGNOFF',
    name: 'Missing or Expired Ethics Approval',
    description: 'Institutional Ethics Board sign-off is absent or past its expiry date.',
    severity: 'High',
    stage: 6,
    linkedGovernanceRequirement: 'GOV_REQ_6',
    acceptableUnderPolicy: false,
  },
  {
    id: 'RISK_ACCOUNTABILITY_GAP',
    name: 'Missing Model Card Documentation',
    description: 'Intended uses, evaluation context, and ownership accountability are not consolidated.',
    severity: 'Medium',
    stage: 6,
    linkedGovernanceRequirement: 'GOV_REQ_6',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_FORESEEABLE_MISUSE',
    name: 'Unassessed Foreseeable Misuse',
    description: 'Potential misuse or adversarial gaming scenarios lack documented safeguards.',
    severity: 'High',
    stage: 6,
    linkedGovernanceRequirement: 'GOV_REQ_6',
    acceptableUnderPolicy: true,
  },
  {
    id: 'RISK_HIDDEN_AI_DISCLOSURE',
    name: 'Missing End-User AI Disclosure',
    description: 'Students and staff are not clearly informed when AI assists or makes decisions.',
    severity: 'Low',
    stage: 6,
    linkedGovernanceRequirement: 'GOV_REQ_6',
    acceptableUnderPolicy: true,
  },
];

export function getKnowledgeGraphPayload() {
  return {
    stages: STAGES,
    artefacts: ARTEFACTS,
    risks: RISKS,
    governanceRequirements: GOVERNANCE_REQUIREMENTS,
  };
}

export function buildProjectJsonLd(
  project: ProjectRecord,
  assessment: AssessmentResult | null
): Record<string, unknown> {
  const evidenceStatusMap = new Map<string, string>();
  const riskStatusMap = new Map<string, string>();
  if (assessment) {
    for (const s of assessment.stageSummaries) {
      for (const a of s.artefactDetails) {
        evidenceStatusMap.set(a.artefactId, a.classification);
      }
    }
    for (const r of assessment.riskSummaries) {
      riskStatusMap.set(r.riskId, r.status);
    }
  }

  return {
    '@context': {
      '@vocab': 'https://univ-ai-governance.edu/ontology/',
      schema: 'https://schema.org/',
      name: 'schema:name',
      description: 'schema:description',
    },
    '@type': 'AIGovernanceProject',
    '@id': `project:${project.id}`,
    name: project.name,
    description: project.description,
    demonstrationDataLabel: project.is_demo
      ? 'DEMONSTRATION DATA: not real institutional approvals or governance decisions.'
      : undefined,
    isDemo: project.is_demo,
    workflowState: project.workflow_state,
    deploymentAutonomy: project.deployment_autonomy,
    affectsStudentAcademicStanding: project.affects_academic_standing,
    dataSensitivity: project.data_sensitivity,
    overallReadiness: assessment ? assessment.overallReadiness : null,
    releaseStatusBanner: assessment ? assessment.releaseStatusBanner : null,
    stages: STAGES.map((st) => ({
      '@type': 'LifecycleStage',
      '@id': `stage:${st.stage}`,
      name: st.name,
      focus: st.focus,
      acceptanceCriteria: st.acceptanceCriteria,
      readinessScore: assessment?.stageSummaries.find((s) => s.stage === st.stage)?.rs ?? null,
      gatePassed: assessment?.stageSummaries.find((s) => s.stage === st.stage)?.gs ?? null,
      artefacts: ARTEFACTS.filter((a) => a.stage === st.stage).map((a) => ({
        '@type': 'GovernanceArtefact',
        '@id': `artefact:${a.id}`,
        name: a.name,
        weight: a.weight,
        isBlocking: a.isBlocking,
        evidenceStatus: evidenceStatusMap.get(a.id) ?? 'Unknown',
        reducesRisks: a.reducesRisks.map((rid) => `risk:${rid}`),
      })),
    })),
    risks: RISKS.map((r) => ({
      '@type': 'GovernanceRisk',
      '@id': `risk:${r.id}`,
      name: r.name,
      severity: r.severity,
      acceptableUnderPolicy: r.acceptableUnderPolicy,
      status: riskStatusMap.get(r.id) ?? 'Unknown',
      linkedGovernanceRequirement: `govreq:${r.linkedGovernanceRequirement}`,
    })),
    governanceRequirements: GOVERNANCE_REQUIREMENTS.map((g) => ({
      '@type': 'GovernanceRequirement',
      '@id': `govreq:${g.id}`,
      name: g.title,
      description: g.description,
    })),
  };
}
