export type UserRole =
  | 'PROJECT_OWNER'
  | 'REVIEWER'
  | 'ADMIN'
  | 'RISK_ACCEPTANCE_AUTHORITY';

export type EvidenceStatus = 'Not submitted' | 'Submitted' | 'Verified' | 'Unclear';
export type WorkflowState =
  | 'Draft'
  | 'Automated Check Passed'
  | 'Exception Requested'
  | 'Exception-Based Review Eligible'
  | 'Reviewer Sign-Off'
  | 'Cleared for Controlled Release';

export interface User {
  id: string;
  email?: string;
  full_name: string;
  role: UserRole;
  is_active?: boolean;
  force_password_change?: boolean;
  is_demo: boolean;
  created_at?: string;
}

export interface StageDef {
  stage: number;
  id: string;
  name: string;
  focus: string;
  acceptanceCriteria: string;
}

export interface ArtefactDef {
  id: string;
  name: string;
  stage: number;
  weight: number;
  isBlocking: boolean;
  whyItMatters: string;
  reducesRisks: string[];
}

export interface RiskDef {
  id: string;
  name: string;
  description: string;
  severity: 'High' | 'Medium' | 'Low';
  stage: number;
  linkedGovernanceRequirement: string;
  acceptableUnderPolicy: boolean;
}

export interface GovReqDef {
  id: string;
  title: string;
  description: string;
  stage: number;
}

export interface KnowledgeGraphData {
  stages: StageDef[];
  artefacts: ArtefactDef[];
  risks: RiskDef[];
  governanceRequirements: GovReqDef[];
}

export interface RetrievedClauseHit {
  clauseId: string;
  source: string;
  sectionNumber: string;
  title: string;
  text: string;
  bm25Score: number;
  tfidfScore: number;
  hybridScore: number;
  matchedTerms: string[];
  confidence: 'High' | 'Medium' | 'Low';
  confidenceLabel: string;
  needsHumanInspection: boolean;
  relatedClauses: Array<{
    clauseId: string;
    title: string;
    source: string;
    sectionNumber: string;
    text: string;
  }>;
}

export interface GuidanceItem {
  id: string;
  ruleId: string;
  stage: number;
  artefactId: string | null;
  artefactName: string | null;
  riskId: string | null;
  riskName: string | null;
  severity: 'High' | 'Medium' | 'Low';
  query: string;
  plainHeadline: string;
  whyItMatters: string;
  howToFixFromPolicy: string;
  clauses: RetrievedClauseHit[];
  topConfidence: 'High' | 'Medium' | 'Low';
  needsHumanInspection: boolean;
}

export interface StageSummary {
  stage: number;
  name: string;
  focus: string;
  rs: number;
  gs: 0 | 1;
  effectiveGs: 0 | 1;
  scoreHighButGateLocked: boolean;
  statusWord: 'Done' | 'Needs attention' | 'Blocked' | 'Not started';
  verifiedCount: number;
  totalCount: number;
  blockingVerifiedCount: number;
  blockingTotalCount: number;
  artefactDetails: Array<{
    artefactId: string;
    name: string;
    weight: number;
    isBlocking: boolean;
    rawStatus: EvidenceStatus;
    classification: string;
    inDate: boolean;
    expiryDate: string | null;
    coveredByExceptionId: string | null;
    whyItMatters: string;
  }>;
}

export interface RiskSummary {
  riskId: string;
  name: string;
  description: string;
  severity: 'High' | 'Medium' | 'Low';
  stage: number;
  linkedGovernanceRequirement: string;
  acceptableUnderPolicy: boolean;
  status: 'Open' | 'In remediation' | 'Mitigated' | 'Excepted' | 'Formally Accepted';
  triggeringRuleIds: string[];
  acceptanceRecordId: string | null;
  exceptionId: string | null;
  plainExplanation: string;
}

export interface RuleTraceEntry {
  step: number;
  ruleId: string;
  ruleName: string;
  ruleType: 'BLOCKING' | 'EXCEPTION' | 'WARNING' | 'INFO';
  priority: number;
  stage: number;
  matchedFacts: string[];
  derivedFacts: string[];
  outcome: string;
  plainExplanation: string;
  targetArtefacts: string[];
  targetRisks: string[];
  governanceReqId: string;
}

export interface RuleConflict {
  id: string;
  target: string;
  blockingRuleId: string;
  exceptionRuleId: string;
  winningRuleId: string;
  resolution: string;
  overriddenByExceptionId: string | null;
}

export interface AssessmentResult {
  runId: string;
  projectId: string;
  evaluatedAt: string;
  overallReadiness: number;
  readinessLabel: 'Not started' | 'In progress' | 'Almost there' | 'Complete';
  releaseStatusBanner: string;
  releaseStatusSentence: string;
  releaseLocked: boolean;
  releaseLockedReasons: string[];
  automatedCheckPassed: boolean;
  reliesOnException: boolean;
  highRiskOpenCount: number;
  openRiskCount: number;
  stagesCompleteCount: number;
  stageSummaries: StageSummary[];
  riskSummaries: RiskSummary[];
  firedRules: RuleTraceEntry[];
  derivedFacts: string[];
  conflicts: RuleConflict[];
  guidanceItems: GuidanceItem[];
  nextActions: Array<{
    priority: number;
    title: string;
    detail: string;
    ruleId: string;
    stage: number;
  }>;
  expiredNotices: string[];
}

export interface ProjectItem {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  owner_name?: string;
  owner_email?: string;
  assigned_reviewer_id: string;
  reviewer_name?: string;
  reviewer_email?: string;
  deployment_autonomy: 'advisory' | 'automated_action';
  affects_academic_standing: boolean;
  data_sensitivity: 'low' | 'medium' | 'high';
  uses_synthetic_data: boolean;
  uses_third_party_wrapper: boolean;
  is_low_risk_admin_script: boolean;
  target_user_population: string;
  workflow_state: WorkflowState;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  latestAssessment?: AssessmentResult | null;
}

export interface EvidenceItem {
  id: string;
  project_id: string;
  artefact_id: string;
  status: EvidenceStatus;
  notes: string;
  file_name: string | null;
  file_size: number | null;
  file_checksum: string | null;
  external_link: string | null;
  expiry_date: string | null;
  missingness_pct: number | null;
  updated_at: string;
}

export interface FairnessCheck {
  project_id: string;
  metric_name: string;
  cohorts: Array<{ cohort: string; metricName: string; value: number }>;
  max_gap: number | null;
  tolerance_used: number;
  passed: boolean;
  checked_at: string;
}

export interface ExceptionItem {
  id: string;
  project_id: string;
  requester_id: string;
  requester_name?: string;
  target_type: 'rule' | 'artefact';
  target_id: string;
  rationale: string;
  expiry_date: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Expired';
  reviewer_id: string | null;
  reviewer_name?: string;
  reviewer_comment: string | null;
  reviewed_at: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface RiskAcceptanceItem {
  id: string;
  project_id: string;
  risk_id: string;
  approver_id: string;
  approver_name?: string;
  rationale: string;
  scope: string;
  expiry_date: string;
  status: 'Active' | 'Expired' | 'Revoked';
  is_demo: boolean;
  created_at: string;
}

export interface ReviewCommentItem {
  id: string;
  project_id: string;
  author_id: string;
  author_name?: string;
  author_role?: string;
  comment: string;
  action_type: string;
  is_demo: boolean;
  created_at: string;
}

export interface RuleItem {
  id: string;
  name: string;
  type: 'BLOCKING' | 'EXCEPTION' | 'WARNING' | 'INFO';
  priority: number;
  stage: number;
  severity: 'High' | 'Medium' | 'Low';
  supported_governance_req: string;
  condition_summary: string;
  action_summary: string;
  dependencies: string[];
  enabled: boolean;
}

export interface PolicyClauseItem {
  clause_id: string;
  source: string;
  section_number: string;
  title: string;
  text: string;
  tags: string[];
  related_clause_ids: string[];
  is_active: boolean;
  is_demo: boolean;
}

export interface SystemSettings {
  missingness_threshold: number;
  parity_tolerance: number;
  readiness_threshold: number;
  retrieval_high_threshold: number;
  retrieval_medium_threshold: number;
  hybrid_weight: number;
  bm25_k1: number;
  bm25_b: number;
}

export interface AuditEntryItem {
  seq_num: number;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  user_role: string | null;
  action: string;
  project_id: string | null;
  details: string;
  rationale: string | null;
  expiry_date: string | null;
  source_ip: string | null;
  prev_hash: string;
  entry_hash: string;
  is_demo: boolean;
}
