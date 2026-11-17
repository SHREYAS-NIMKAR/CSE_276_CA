import crypto from 'crypto';
import { ARTEFACTS, RISKS, STAGES } from './knowledge';
import { buildGroundedGuidanceText, retrievePolicyClauses } from './retrieval';
import { computeScoringAndRisks } from './scoring';
import {
  AssessmentResult,
  EvidenceRecord,
  ExceptionRecord,
  FairnessCheckRecord,
  GuidanceItem,
  MissingClassification,
  PolicyClause,
  ProjectRecord,
  RiskAcceptanceRecord,
  RuleConflict,
  RuleDefinition,
  RuleTraceEntry,
  SystemSettings,
} from './types';

export const DEFAULT_RULES: RuleDefinition[] = [
  {
    id: 'R1',
    name: 'Academic Standing Subgroup Fairness Gate',
    type: 'BLOCKING',
    priority: 100,
    stage: 3,
    severity: 'High',
    supported_governance_req: 'GOV_REQ_3',
    condition_summary:
      'IF project affects student academic standing AND subgroup error matrix is not Verified (or fairness parity check failed)',
    action_summary:
      'Raise HIGH-RISK flag (Unverified Subgroup Fairness Parity) and block Stage 3 and release clearance.',
    dependencies: [],
    enabled: true,
  },
  {
    id: 'R2',
    name: 'Data Governance Datasheet and Consent Gate',
    type: 'BLOCKING',
    priority: 95,
    stage: 1,
    severity: 'High',
    supported_governance_req: 'GOV_REQ_1',
    condition_summary:
      'IF dataset datasheet or consent record is missing, expired, or unverified',
    action_summary:
      'Block Stage 1 Data Governance clearance and flag privacy/consent risk.',
    dependencies: [],
    enabled: true,
  },
  {
    id: 'R4',
    name: 'Ethics Board Sign-Off Validity Gate',
    type: 'BLOCKING',
    priority: 95,
    stage: 6,
    severity: 'High',
    supported_governance_req: 'GOV_REQ_6',
    condition_summary:
      'IF ethics board sign-off is missing, unverified, or past its server-checked expiry date',
    action_summary:
      'Block Stage 6 Responsible-Use clearance and raise HIGH-RISK ethics flag.',
    dependencies: [],
    enabled: true,
  },
  {
    id: 'R3',
    name: 'Automated Deployment Rollback Gate',
    type: 'BLOCKING',
    priority: 90,
    stage: 5,
    severity: 'High',
    supported_governance_req: 'GOV_REQ_5',
    condition_summary:
      'IF deployment autonomy is automated_action AND rollback plan is not Verified',
    action_summary:
      'Block Stage 5 Deployment Readiness and release clearance.',
    dependencies: [],
    enabled: true,
  },
  {
    id: 'R11',
    name: 'Stage 1 Missingness Quality Threshold Gate',
    type: 'BLOCKING',
    priority: 88,
    stage: 1,
    severity: 'Medium',
    supported_governance_req: 'GOV_REQ_1',
    condition_summary:
      'IF Stage 1 schema profile reports missingness above configured missingness threshold',
    action_summary:
      'Block Stage 1 clearance until data quality remediation is documented.',
    dependencies: [],
    enabled: true,
  },
  {
    id: 'R12',
    name: 'Model Card and Misuse Assessment Gate',
    type: 'BLOCKING',
    priority: 85,
    stage: 6,
    severity: 'High',
    supported_governance_req: 'GOV_REQ_6',
    condition_summary:
      'IF model card or misuse assessment is not Verified on non-trivial deployments',
    action_summary:
      'Block Stage 6 clearance and flag accountability/misuse risk.',
    dependencies: [],
    enabled: true,
  },
  {
    id: 'R6',
    name: 'Unclear Artefact Human Review Escalation',
    type: 'WARNING',
    priority: 65,
    stage: 0,
    severity: 'Medium',
    supported_governance_req: 'GOV_REQ_4',
    condition_summary:
      'IF any lifecycle artefact is marked Unclear',
    action_summary:
      'Mark affected stage NEEDS REVIEW and route to human reviewer queue.',
    dependencies: [],
    enabled: true,
  },
  {
    id: 'R5',
    name: 'Explainability Completeness Warning',
    type: 'WARNING',
    priority: 60,
    stage: 4,
    severity: 'Medium',
    supported_governance_req: 'GOV_REQ_4',
    condition_summary:
      'IF any Stage 4 explainability artefact is missing or unverified',
    action_summary:
      'Mark Stage 4 INCOMPLETE and raise AMBER transparency flag.',
    dependencies: [],
    enabled: true,
  },
  {
    id: 'R7',
    name: 'Interpretable Baseline Justification Warning',
    type: 'WARNING',
    priority: 55,
    stage: 2,
    severity: 'Medium',
    supported_governance_req: 'GOV_REQ_2',
    condition_summary:
      'IF baseline benchmark artefact is not Verified',
    action_summary:
      'Warn that model selection and complexity are not empirically justified over a simpler baseline.',
    dependencies: [],
    enabled: true,
  },
  {
    id: 'R8',
    name: 'Synthetic Data or Wrapper Exception Eligibility',
    type: 'EXCEPTION',
    priority: 45,
    stage: 1,
    severity: 'Low',
    supported_governance_req: 'GOV_REQ_1',
    condition_summary:
      'IF project uses synthetic data or a third-party foundation model wrapper without raw weights',
    action_summary:
      'Allow a time-bound exception request with documented rationale for affected provenance_log and architecture_rationale items only.',
    dependencies: [],
    enabled: true,
  },
  {
    id: 'R9',
    name: 'Low-Risk Internal Script Streamlined Path',
    type: 'EXCEPTION',
    priority: 40,
    stage: 6,
    severity: 'Low',
    supported_governance_req: 'GOV_REQ_6',
    condition_summary:
      'IF project is a low-risk internal administrative script',
    action_summary:
      'Offer streamlined review path (non-blocking artefacts optional; still subject to R2 and R4 if personal data is involved).',
    dependencies: [],
    enabled: true,
  },
  {
    id: 'R10',
    name: 'Automated Readiness Clearance Derivation',
    type: 'INFO',
    priority: 10,
    stage: 6,
    severity: 'Low',
    supported_governance_req: 'GOV_REQ_6',
    condition_summary:
      'IF every stage 1-6 is complete AND no blocking gate_open(stage) remains (without relying on exceptions) AND high_risk_open is false',
    action_summary:
      'Derive automated_check_passed = true and set outcome "Automated Check Passed".',
    dependencies: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R11', 'R12'],
    enabled: true,
  },
];

export interface EvaluationInput {
  project: ProjectRecord;
  evidence: EvidenceRecord[];
  fairnessCheck: FairnessCheckRecord | null;
  exceptions: ExceptionRecord[];
  riskAcceptances: RiskAcceptanceRecord[];
  rules: RuleDefinition[];
  clauses: PolicyClause[];
  settings: SystemSettings;
  now?: Date;
}

export function classifyArtefactStatus(
  ev: EvidenceRecord | undefined,
  now: Date
): { rawStatus: EvidenceRecord['status']; classification: MissingClassification; inDate: boolean } {
  if (!ev || ev.status === 'Not submitted') {
    return { rawStatus: 'Not submitted', classification: 'Not submitted', inDate: false };
  }
  const expired = Boolean(ev.expiry_date && new Date(ev.expiry_date).getTime() < now.getTime());
  if (expired) {
    return { rawStatus: ev.status, classification: 'Expired', inDate: false };
  }
  if (ev.status === 'Verified') {
    return { rawStatus: 'Verified', classification: 'Verified', inDate: true };
  }
  if (ev.status === 'Submitted') {
    return { rawStatus: 'Submitted', classification: 'Submitted but unverified', inDate: true };
  }
  return { rawStatus: 'Unclear', classification: 'Unclear', inDate: true };
}

export function runForwardChainingAssessment(input: EvaluationInput): AssessmentResult {
  const now = input.now ?? new Date();
  const evidenceByArtefact = new Map(input.evidence.map((e) => [e.artefact_id, e]));

  // Check active approved exceptions & formal risk acceptances against server time
  const expiredNotices: string[] = [];
  const activeExceptions: ExceptionRecord[] = [];
  for (const ex of input.exceptions) {
    if (ex.status === 'Approved') {
      if (new Date(ex.expiry_date).getTime() < now.getTime()) {
        expiredNotices.push(
          `Exception ${ex.id} for ${ex.target_type} "${ex.target_id}" expired on ${ex.expiry_date.slice(0, 10)}; blocker re-opened.`
        );
      } else {
        activeExceptions.push(ex);
      }
    }
  }

  const activeAcceptances: RiskAcceptanceRecord[] = [];
  for (const acc of input.riskAcceptances) {
    if (acc.status === 'Active') {
      if (new Date(acc.expiry_date).getTime() < now.getTime()) {
        expiredNotices.push(
          `Formal risk acceptance ${acc.id} for ${acc.risk_id} expired on ${acc.expiry_date.slice(0, 10)}; risk re-opened.`
        );
      } else {
        activeAcceptances.push(acc);
      }
    }
  }

  const isCoveredByException = (ruleId: string, artefactIds: string[]): ExceptionRecord | null => {
    for (const ex of activeExceptions) {
      if (ex.target_type === 'rule' && ex.target_id === ruleId) return ex;
      if (ex.target_type === 'artefact' && artefactIds.includes(ex.target_id)) return ex;
    }
    return null;
  };

  // Working memory facts
  const facts = new Set<string>();
  const artefactStatus = new Map<string, ReturnType<typeof classifyArtefactStatus>>();
  for (const art of ARTEFACTS) {
    const st = classifyArtefactStatus(evidenceByArtefact.get(art.id), now);
    artefactStatus.set(art.id, st);
    facts.add(`artefact:${art.id}=${st.classification}`);
  }

  facts.add(`autonomy=${input.project.deployment_autonomy}`);
  facts.add(`sensitivity=${input.project.data_sensitivity}`);
  if (input.project.affects_academic_standing) facts.add('affects_academic_standing');
  if (input.project.uses_synthetic_data) facts.add('uses_synthetic_data');
  if (input.project.uses_third_party_wrapper) facts.add('uses_third_party_wrapper');
  if (input.project.is_low_risk_admin_script) facts.add('is_low_risk_admin_script');

  // Check fairness pass
  const fairnessPassed = Boolean(
    input.fairnessCheck &&
      input.fairnessCheck.cohorts.length >= 2 &&
      input.fairnessCheck.max_gap !== null &&
      input.fairnessCheck.max_gap <= input.settings.parity_tolerance
  );
  facts.add(fairnessPassed ? 'fairness_check=pass' : 'fairness_check=fail');

  // Check missingness on stage 1 schema_profile
  const schemaEv = evidenceByArtefact.get('schema_profile');
  const missingnessExceeded = Boolean(
    schemaEv &&
      schemaEv.missingness_pct !== null &&
      schemaEv.missingness_pct !== undefined &&
      schemaEv.missingness_pct > input.settings.missingness_threshold
  );
  if (missingnessExceeded) {
    facts.add('missingness_exceeds_threshold');
  }

  // Track rule engine outputs
  const ruleMap = new Map(input.rules.map((r) => [r.id, r]));
  const typeOrder: Record<string, number> = {
    BLOCKING: 4,
    EXCEPTION: 3,
    WARNING: 2,
    INFO: 1,
  };
  const sortedRules = [...input.rules]
    .filter((r) => r.enabled)
    .sort((a, b) => typeOrder[b.type] - typeOrder[a.type] || b.priority - a.priority);

  const firedRuleSignatures = new Map<string, string>();
  const firedRules: RuleTraceEntry[] = [];
  const derivedFacts: string[] = [];
  const conflicts: RuleConflict[] = [];
  const ruleOutcomesByTarget = new Map<
    string,
    {
      ruleId: string;
      type: string;
      priority: number;
      outcome: 'block' | 'allow';
      targetArtefacts: string[];
    }[]
  >();

  // Track which rules triggered which risks/artefacts for scoring & guidance
  const triggeredRiskRuleIds = new Map<string, Set<string>>();
  const addRiskTrigger = (riskId: string, ruleId: string) => {
    if (!triggeredRiskRuleIds.has(riskId)) triggeredRiskRuleIds.set(riskId, new Set());
    triggeredRiskRuleIds.get(riskId)!.add(ruleId);
  };

  const addDerivedFact = (fact: string) => {
    if (!facts.has(fact)) {
      facts.add(fact);
      derivedFacts.push(fact);
      return true;
    }
    return false;
  };

  // Iterative forward-chaining loop
  const MAX_ITERATIONS = 50;
  let iteration = 0;
  let changed = true;

  while (changed && iteration < MAX_ITERATIONS) {
    changed = false;
    iteration += 1;

    // Recompute stage_complete facts dynamically from current working memory & evidence
    for (const st of STAGES) {
      const stageArts = ARTEFACTS.filter((a) => a.stage === st.stage);
      const allBlockingVerified = stageArts
        .filter((a) => a.isBlocking)
        .every((a) => artefactStatus.get(a.id)?.classification === 'Verified');
      const allArtefactsVerified = stageArts.every(
        (a) => artefactStatus.get(a.id)?.classification === 'Verified'
      );
      if (allBlockingVerified && allArtefactsVerified && !facts.has(`gate_open(${st.stage})`)) {
        if (addDerivedFact(`stage_complete(${st.stage})`)) {
          changed = true;
        }
      }
    }

    // Derive high_risk_open if any high-severity risk is triggered and not formally accepted
    const highRiskTriggered = Array.from(triggeredRiskRuleIds.keys()).some((rid) => {
      const rDef = RISKS.find((r) => r.id === rid);
      if (!rDef || rDef.severity !== 'High') return false;
      const accepted = activeAcceptances.some(
        (acc) => acc.risk_id === rid && rDef.acceptableUnderPolicy
      );
      return !accepted;
    });
    if (highRiskTriggered) {
      if (addDerivedFact('high_risk_open')) changed = true;
    }

    for (const rule of sortedRules) {
      const factSig = Array.from(facts).sort().join('|');
      if (firedRuleSignatures.has(rule.id)) {
        continue; // Each rule fires at most once per run once matched, preventing infinite loops
      }

      let matched = false;
      const matchedFacts: string[] = [];
      const ruleDerived: string[] = [];
      let outcome = '';
      let plainExplanation = '';
      let targetArtefacts: string[] = [];
      let targetRisks: string[] = [];

      if (rule.id === 'R1') {
        const subStatus = artefactStatus.get('subgroup_error_matrix')?.classification ?? 'Not submitted';
        if (
          facts.has('affects_academic_standing') &&
          (subStatus !== 'Verified' || !fairnessPassed)
        ) {
          matched = true;
          matchedFacts.push('affects_academic_standing');
          matchedFacts.push(`artefact:subgroup_error_matrix=${subStatus}`);
          if (!fairnessPassed) matchedFacts.push('fairness_check=fail');
          targetArtefacts = ['subgroup_error_matrix'];
          targetRisks = ['RISK_SUBGROUP_PARITY'];
          addRiskTrigger('RISK_SUBGROUP_PARITY', 'R1');
          const ex = isCoveredByException('R1', ['subgroup_error_matrix']);
          ruleDerived.push('gate_open(3)', 'high_risk_open');
          if (ex) {
            ruleDerived.push('effective_gate_covered(3)');
            outcome = `BLOCKER OVERRIDDEN BY APPROVED EXCEPTION ${ex.id} (until ${ex.expiry_date.slice(0, 10)})`;
            plainExplanation =
              'This project affects student academic standing and lacks a verified subgroup fairness matrix, but an approved temporary exception covers this gate for review.';
          } else {
            ruleDerived.push('effective_gate_open(3)');
            outcome = 'BLOCK RELEASE: High-risk subgroup parity flag raised; Stage 3 gate open.';
            plainExplanation =
              'Because this project affects student academic standing, it requires a verified subgroup error matrix passing the fairness parity check before release.';
          }
          ruleOutcomesByTarget.set('stage:3', [
            ...(ruleOutcomesByTarget.get('stage:3') ?? []),
            {
              ruleId: 'R1',
              type: rule.type,
              priority: rule.priority,
              outcome: 'block',
              targetArtefacts,
            },
          ]);
        }
      } else if (rule.id === 'R2') {
        const ds = artefactStatus.get('dataset_datasheet')?.classification ?? 'Not submitted';
        const cr = artefactStatus.get('consent_record')?.classification ?? 'Not submitted';
        const missingArts: string[] = [];
        if (ds !== 'Verified') missingArts.push('dataset_datasheet');
        if (cr !== 'Verified') missingArts.push('consent_record');
        if (missingArts.length > 0) {
          matched = true;
          matchedFacts.push(`artefact:dataset_datasheet=${ds}`, `artefact:consent_record=${cr}`);
          targetArtefacts = missingArts;
          targetRisks = ['RISK_PII_LEAK', 'RISK_CONSENT_VIOLATION'];
          if (ds !== 'Verified') addRiskTrigger('RISK_PII_LEAK', 'R2');
          if (cr !== 'Verified') addRiskTrigger('RISK_CONSENT_VIOLATION', 'R2');
          const ex = isCoveredByException('R2', missingArts);
          ruleDerived.push('gate_open(1)');
          if (ex) {
            ruleDerived.push('effective_gate_covered(1)');
            outcome = `Stage 1 gate covered by approved exception ${ex.id}`;
            plainExplanation =
              'Data governance documentation is incomplete, covered temporarily by an approved exception.';
          } else {
            ruleDerived.push('effective_gate_open(1)');
            outcome = 'BLOCK STAGE 1: Dataset datasheet or consent record is not verified.';
            plainExplanation =
              'Stage 1 Data Governance cannot pass until both the Dataset Datasheet and Consent Record are submitted and verified.';
          }
          ruleOutcomesByTarget.set('stage:1', [
            ...(ruleOutcomesByTarget.get('stage:1') ?? []),
            {
              ruleId: 'R2',
              type: rule.type,
              priority: rule.priority,
              outcome: 'block',
              targetArtefacts,
            },
          ]);
        }
      } else if (rule.id === 'R3') {
        const rb = artefactStatus.get('rollback_plan')?.classification ?? 'Not submitted';
        if (facts.has('autonomy=automated_action') && rb !== 'Verified') {
          matched = true;
          matchedFacts.push('autonomy=automated_action', `artefact:rollback_plan=${rb}`);
          targetArtefacts = ['rollback_plan'];
          targetRisks = ['RISK_UNSAFE_AUTOMATION'];
          addRiskTrigger('RISK_UNSAFE_AUTOMATION', 'R3');
          const ex = isCoveredByException('R3', ['rollback_plan']);
          ruleDerived.push('gate_open(5)', 'high_risk_open');
          if (ex) {
            ruleDerived.push('effective_gate_covered(5)');
            outcome = `Stage 5 rollback gate covered by exception ${ex.id}`;
            plainExplanation =
              'Automated deployment lacks a verified rollback plan, currently covered by an approved temporary exception.';
          } else {
            ruleDerived.push('effective_gate_open(5)');
            outcome = 'BLOCK RELEASE: Automated deployment requires a verified rollback plan.';
            plainExplanation =
              'This system takes automated actions, so it must have a verified rollback plan and human fallback before release.';
          }
          ruleOutcomesByTarget.set('stage:5', [
            ...(ruleOutcomesByTarget.get('stage:5') ?? []),
            {
              ruleId: 'R3',
              type: rule.type,
              priority: rule.priority,
              outcome: 'block',
              targetArtefacts,
            },
          ]);
        }
      } else if (rule.id === 'R4') {
        const eb = artefactStatus.get('ethics_board_signoff')?.classification ?? 'Not submitted';
        if (eb !== 'Verified') {
          matched = true;
          matchedFacts.push(`artefact:ethics_board_signoff=${eb}`);
          targetArtefacts = ['ethics_board_signoff'];
          targetRisks = ['RISK_MISSING_ETHICS_SIGNOFF'];
          addRiskTrigger('RISK_MISSING_ETHICS_SIGNOFF', 'R4');
          const ex = isCoveredByException('R4', ['ethics_board_signoff']);
          ruleDerived.push('gate_open(6)', 'high_risk_open');
          if (ex) {
            ruleDerived.push('effective_gate_covered(6)');
            outcome = `Stage 6 ethics gate covered by exception ${ex.id}`;
            plainExplanation =
              'Ethics board sign-off is missing or expired, covered temporarily by an approved exception.';
          } else {
            ruleDerived.push('effective_gate_open(6)');
            outcome =
              eb === 'Expired'
                ? 'BLOCK STAGE 6: Ethics board sign-off has expired.'
                : 'BLOCK STAGE 6: Ethics board sign-off is missing or unverified.';
            plainExplanation =
              eb === 'Expired'
                ? 'The Ethics Board sign-off has passed its expiry date and must be renewed and verified.'
                : 'Institutional Ethics Board sign-off is required and must be verified before release.';
          }
          ruleOutcomesByTarget.set('stage:6', [
            ...(ruleOutcomesByTarget.get('stage:6') ?? []),
            {
              ruleId: 'R4',
              type: rule.type,
              priority: rule.priority,
              outcome: 'block',
              targetArtefacts,
            },
          ]);
        }
      } else if (rule.id === 'R11') {
        if (missingnessExceeded) {
          matched = true;
          matchedFacts.push('missingness_exceeds_threshold');
          targetArtefacts = ['schema_profile'];
          targetRisks = ['RISK_DATA_QUALITY'];
          addRiskTrigger('RISK_DATA_QUALITY', 'R11');
          const ex = isCoveredByException('R11', ['schema_profile']);
          ruleDerived.push('gate_open(1)');
          if (!ex) ruleDerived.push('effective_gate_open(1)');
          outcome = `BLOCK STAGE 1: Dataset missingness (${((schemaEv?.missingness_pct ?? 0) * 100).toFixed(1)}%) exceeds threshold (${(input.settings.missingness_threshold * 100).toFixed(1)}%).`;
          plainExplanation =
            'The dataset schema profile shows missing values above the university threshold, blocking Stage 1 clearance.';
        }
      } else if (rule.id === 'R12') {
        const mc = artefactStatus.get('model_card')?.classification ?? 'Not submitted';
        const ma = artefactStatus.get('misuse_assessment')?.classification ?? 'Not submitted';
        const streamlinedLow =
          facts.has('is_low_risk_admin_script') && facts.has('sensitivity=low');
        const missingArts: string[] = [];
        if (mc !== 'Verified') missingArts.push('model_card');
        if (ma !== 'Verified') missingArts.push('misuse_assessment');
        if (!streamlinedLow && missingArts.length > 0) {
          matched = true;
          matchedFacts.push(`artefact:model_card=${mc}`, `artefact:misuse_assessment=${ma}`);
          targetArtefacts = missingArts;
          targetRisks = [];
          if (mc !== 'Verified') {
            targetRisks.push('RISK_ACCOUNTABILITY_GAP');
            addRiskTrigger('RISK_ACCOUNTABILITY_GAP', 'R12');
          }
          if (ma !== 'Verified') {
            targetRisks.push('RISK_FORESEEABLE_MISUSE');
            addRiskTrigger('RISK_FORESEEABLE_MISUSE', 'R12');
          }
          const ex = isCoveredByException('R12', missingArts);
          ruleDerived.push('gate_open(6)');
          if (!ex) ruleDerived.push('effective_gate_open(6)');
          outcome = ex
            ? `Stage 6 documentation gate covered by exception ${ex.id}`
            : 'BLOCK STAGE 6: Model Card or Misuse Assessment is not verified.';
          plainExplanation =
            'A verified Model Card and Misuse Assessment are needed to document intended use and safeguards.';
        }
      } else if (rule.id === 'R6') {
        const unclearArts = ARTEFACTS.filter(
          (a) => artefactStatus.get(a.id)?.classification === 'Unclear'
        );
        if (unclearArts.length > 0) {
          matched = true;
          targetArtefacts = unclearArts.map((a) => a.id);
          matchedFacts.push(...unclearArts.map((a) => `artefact:${a.id}=Unclear`));
          ruleDerived.push('human_review_requested');
          for (const a of unclearArts) {
            ruleDerived.push(`stage_needs_review(${a.stage})`);
          }
          outcome = `NEEDS REVIEW: ${unclearArts.length} artefact(s) marked Unclear.`;
          plainExplanation = `Human reviewer clarification is needed for: ${unclearArts.map((a) => a.name).join(', ')}.`;
        }
      } else if (rule.id === 'R5') {
        const stage4Arts = ARTEFACTS.filter((a) => a.stage === 4);
        const missing4 = stage4Arts.filter(
          (a) => artefactStatus.get(a.id)?.classification !== 'Verified'
        );
        if (missing4.length > 0) {
          matched = true;
          targetArtefacts = missing4.map((a) => a.id);
          targetRisks = ['RISK_CONTESTABILITY_GAP'];
          addRiskTrigger('RISK_CONTESTABILITY_GAP', 'R5');
          matchedFacts.push(
            ...missing4.map(
              (a) => `artefact:${a.id}=${artefactStatus.get(a.id)?.classification ?? 'Not submitted'}`
            )
          );
          ruleDerived.push('stage_incomplete(4)', 'amber_flag(explainability)');
          outcome = 'WARNING (AMBER): Explainability stage is incomplete.';
          plainExplanation =
            'One or more explainability items (global attributions, local examples, or limitations) still need verification so affected users can contest outputs.';
        }
      } else if (rule.id === 'R7') {
        const bb = artefactStatus.get('baseline_benchmark')?.classification ?? 'Not submitted';
        if (bb !== 'Verified') {
          matched = true;
          targetArtefacts = ['baseline_benchmark'];
          targetRisks = ['RISK_UNJUSTIFIED_COMPLEXITY'];
          addRiskTrigger('RISK_UNJUSTIFIED_COMPLEXITY', 'R7');
          matchedFacts.push(`artefact:baseline_benchmark=${bb}`);
          ruleDerived.push('amber_flag(baseline_unjustified)');
          outcome = 'WARNING: Model choice is not justified against an interpretable baseline.';
          plainExplanation =
            'Verify a Baseline Benchmark showing that this model outperforms a simpler interpretable approach.';
        }
      } else if (rule.id === 'R8') {
        if (facts.has('uses_synthetic_data') || facts.has('uses_third_party_wrapper')) {
          matched = true;
          if (facts.has('uses_synthetic_data')) matchedFacts.push('uses_synthetic_data');
          if (facts.has('uses_third_party_wrapper')) matchedFacts.push('uses_third_party_wrapper');
          targetArtefacts = ['provenance_log', 'architecture_rationale'];
          targetRisks = ['RISK_UNTRACED_LINEAGE'];
          ruleDerived.push('exception_eligible(provenance_architecture)');
          outcome =
            'EXCEPTION PATH ELIGIBLE: Project may request a scoped exception for provenance_log or architecture_rationale with written rationale.';
          plainExplanation =
            'Because this project uses synthetic data or a third-party wrapper without raw weights, you may request a temporary scoped exception for provenance or architecture documentation.';
          ruleOutcomesByTarget.set('stage:1', [
            ...(ruleOutcomesByTarget.get('stage:1') ?? []),
            {
              ruleId: 'R8',
              type: rule.type,
              priority: rule.priority,
              outcome: 'allow',
              targetArtefacts,
            },
          ]);
        }
      } else if (rule.id === 'R9') {
        if (facts.has('is_low_risk_admin_script')) {
          matched = true;
          matchedFacts.push('is_low_risk_admin_script');
          ruleDerived.push('streamlined_path_eligible');
          outcome =
            'STREAMLINED PATH OFFERED: Reduced non-blocking artefact set (still subject to R2 and R4 if personal data is involved).';
          plainExplanation =
            'As a low-risk internal administrative script, non-blocking documentation is streamlined, though data governance and ethics sign-off still apply if personal data is involved.';
          ruleOutcomesByTarget.set('stage:6', [
            ...(ruleOutcomesByTarget.get('stage:6') ?? []),
            {
              ruleId: 'R9',
              type: rule.type,
              priority: rule.priority,
              outcome: 'allow',
              targetArtefacts,
            },
          ]);
        }
      } else if (rule.id === 'R10') {
        // Depends strictly on derived facts from prior rules!
        const allStagesComplete = [1, 2, 3, 4, 5, 6].every((s) => facts.has(`stage_complete(${s})`));
        const anyGateOpen = [1, 2, 3, 4, 5, 6].some((s) => facts.has(`gate_open(${s})`));
        const reliesOnException = activeExceptions.length > 0;
        const highRiskOpen = facts.has('high_risk_open');
        if (allStagesComplete && !anyGateOpen && !reliesOnException && !highRiskOpen) {
          matched = true;
          matchedFacts.push(
            'stage_complete(1..6)',
            'no_gate_open_without_exceptions',
            'high_risk_open=false'
          );
          ruleDerived.push('automated_check_passed');
          outcome = 'Automated Check Passed';
          plainExplanation =
            'All six lifecycle stages are verified, no blocking gates are open without exceptions, and no High risk remains.';
        }
      }

      if (matched) {
        firedRuleSignatures.set(rule.id, factSig);
        for (const df of ruleDerived) {
          if (addDerivedFact(df)) {
            changed = true;
          }
        }
        firedRules.push({
          step: firedRules.length + 1,
          ruleId: rule.id,
          ruleName: rule.name,
          ruleType: rule.type,
          priority: rule.priority,
          stage: rule.stage,
          matchedFacts,
          derivedFacts: ruleDerived,
          outcome,
          plainExplanation,
          targetArtefacts,
          targetRisks,
          governanceReqId: rule.supported_governance_req,
        });
      }
    }
  }

  // Conflict detection & resolution (e.g., BLOCKING rule vs EXCEPTION rule on same stage target)
  for (const [target, actions] of ruleOutcomesByTarget.entries()) {
    const blockers = actions.filter((a) => a.outcome === 'block');
    const allows = actions.filter((a) => a.outcome === 'allow');
    if (blockers.length > 0 && allows.length > 0) {
      for (const b of blockers) {
        for (const al of allows) {
          const ex = isCoveredByException(b.ruleId, b.targetArtefacts);
          conflicts.push({
            id: `CONF-${b.ruleId}-${al.ruleId}`,
            target,
            blockingRuleId: b.ruleId,
            exceptionRuleId: al.ruleId,
            winningRuleId: ex ? al.ruleId : b.ruleId,
            overriddenByExceptionId: ex ? ex.id : null,
            resolution: ex
              ? `Approved exception ${ex.id} names ${ex.target_id} and temporarily waives effective gate; blocker remains recorded.`
              : `Priority resolution: ${b.ruleId} (BLOCKING, priority ${b.priority}) overrides ${al.ruleId} (EXCEPTION, priority ${al.priority}) because no approved in-date exception covers the exact blocker.`,
          });
        }
      }
    }
  }

  // Also check other blocking artefacts missing even if specific rule was disabled by admin
  for (const art of ARTEFACTS) {
    const st = artefactStatus.get(art.id)!;
    if (st.classification !== 'Verified') {
      const ruleForStage = firedRules.find((fr) => fr.targetArtefacts.includes(art.id));
      if (!ruleForStage && art.isBlocking) {
        for (const rid of art.reducesRisks) {
          addRiskTrigger(rid, `GATE_${art.stage}`);
        }
      }
    }
  }

  // Build grounded guidance for fired gaps (BLOCKING / WARNING)
  const guidanceItems: GuidanceItem[] = [];
  const gapRules = firedRules.filter((fr) => fr.ruleType === 'BLOCKING' || fr.ruleType === 'WARNING');

  for (const fr of gapRules) {
    const primaryArtId = fr.targetArtefacts[0] ?? null;
    const primaryArt = primaryArtId ? ARTEFACTS.find((a) => a.id === primaryArtId) ?? null : null;
    const primaryRiskId = fr.targetRisks[0] ?? null;
    const primaryRisk = primaryRiskId ? RISKS.find((r) => r.id === primaryRiskId) ?? null : null;
    const stageDef = STAGES.find((s) => s.stage === (fr.stage || primaryArt?.stage || 1));

    const queryParts = [
      primaryArt?.name ?? '',
      primaryRisk?.name ?? '',
      stageDef?.name ?? '',
      fr.ruleName,
    ].filter(Boolean);
    const query = queryParts.join(' ');
    const hits = retrievePolicyClauses(query, input.clauses, input.settings, 3);
    const topConfidence = hits[0]?.confidence ?? 'Low';
    const needsHumanInspection = hits.length === 0 || hits[0].needsHumanInspection;

    const rDef = ruleMap.get(fr.ruleId);
    guidanceItems.push({
      id: `GUID-${fr.ruleId}`,
      ruleId: fr.ruleId,
      stage: fr.stage || primaryArt?.stage || 1,
      artefactId: primaryArt?.id ?? null,
      artefactName: primaryArt?.name ?? null,
      riskId: primaryRisk?.id ?? null,
      riskName: primaryRisk?.name ?? null,
      severity: rDef?.severity ?? 'Medium',
      query,
      plainHeadline: fr.outcome,
      whyItMatters: primaryArt?.whyItMatters ?? fr.plainExplanation,
      howToFixFromPolicy: buildGroundedGuidanceText(hits),
      clauses: hits,
      topConfidence,
      needsHumanInspection,
    });
  }

  // Compute scoring, gates, risk summaries, and status banners
  const scored = computeScoringAndRisks({
    project: input.project,
    artefactStatus,
    activeExceptions,
    activeAcceptances,
    triggeredRiskRuleIds,
    facts,
    firedRules,
    guidanceItems,
    settings: input.settings,
    expiredNotices,
  });

  const runId = `RUN-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

  return {
    runId,
    projectId: input.project.id,
    evaluatedAt: now.toISOString(),
    overallReadiness: scored.overallReadiness,
    readinessLabel: scored.readinessLabel,
    releaseStatusBanner: scored.releaseStatusBanner,
    releaseStatusSentence: scored.releaseStatusSentence,
    releaseLocked: scored.releaseLocked,
    releaseLockedReasons: scored.releaseLockedReasons,
    automatedCheckPassed: facts.has('automated_check_passed'),
    reliesOnException: activeExceptions.length > 0,
    highRiskOpenCount: scored.highRiskOpenCount,
    openRiskCount: scored.openRiskCount,
    stagesCompleteCount: scored.stagesCompleteCount,
    stageSummaries: scored.stageSummaries,
    riskSummaries: scored.riskSummaries,
    firedRules,
    derivedFacts,
    conflicts,
    guidanceItems,
    nextActions: scored.nextActions,
    expiredNotices,
  };
}
