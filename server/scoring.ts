import { ARTEFACTS, RISKS, STAGES } from './knowledge';
import {
  AssessmentResult,
  EvidenceRecord,
  ExceptionRecord,
  GuidanceItem,
  MissingClassification,
  ProjectRecord,
  RiskAcceptanceRecord,
  RiskEvaluationSummary,
  RiskStatus,
  RuleTraceEntry,
  StageScoreSummary,
  SystemSettings,
} from './types';

interface ScoringInput {
  project: ProjectRecord;
  artefactStatus: Map<
    string,
    { rawStatus: EvidenceRecord['status']; classification: MissingClassification; inDate: boolean }
  >;
  activeExceptions: ExceptionRecord[];
  activeAcceptances: RiskAcceptanceRecord[];
  triggeredRiskRuleIds: Map<string, Set<string>>;
  facts: Set<string>;
  firedRules: RuleTraceEntry[];
  guidanceItems: GuidanceItem[];
  settings: SystemSettings;
  expiredNotices: string[];
}

export function computeScoringAndRisks(input: ScoringInput): {
  overallReadiness: number;
  readinessLabel: AssessmentResult['readinessLabel'];
  releaseStatusBanner: string;
  releaseStatusSentence: string;
  releaseLocked: boolean;
  releaseLockedReasons: string[];
  highRiskOpenCount: number;
  openRiskCount: number;
  stagesCompleteCount: number;
  stageSummaries: StageScoreSummary[];
  riskSummaries: RiskEvaluationSummary[];
  nextActions: AssessmentResult['nextActions'];
} {
  const stageSummaries: StageScoreSummary[] = [];
  const releaseLockedReasons: string[] = [...input.expiredNotices];

  for (const st of STAGES) {
    const stageArts = ARTEFACTS.filter((a) => a.stage === st.stage);
    let rs = 0;
    let verifiedCount = 0;
    let blockingVerifiedCount = 0;
    let blockingTotalCount = 0;
    let effectiveBlockingSatisfied = true;

    const artefactDetails: StageScoreSummary['artefactDetails'] = [];

    for (const art of stageArts) {
      const stInfo = input.artefactStatus.get(art.id)!;
      const v = stInfo.classification === 'Verified' && stInfo.inDate ? 1 : 0;
      rs += art.weight * v;
      if (v === 1) verifiedCount += 1;

      const coveringEx =
        input.activeExceptions.find(
          (ex) =>
            (ex.target_type === 'artefact' && ex.target_id === art.id) ||
            (ex.target_type === 'rule' &&
              input.firedRules.some(
                (fr) => fr.ruleId === ex.target_id && fr.targetArtefacts.includes(art.id)
              ))
        ) ?? null;

      if (art.isBlocking) {
        blockingTotalCount += 1;
        if (v === 1) {
          blockingVerifiedCount += 1;
        } else if (!coveringEx) {
          effectiveBlockingSatisfied = false;
        }
      }

      artefactDetails.push({
        artefactId: art.id,
        name: art.name,
        weight: art.weight,
        isBlocking: art.isBlocking,
        rawStatus: stInfo.rawStatus,
        classification: stInfo.classification,
        inDate: stInfo.inDate,
        expiryDate: null,
        coveredByExceptionId: coveringEx ? coveringEx.id : null,
        whyItMatters: art.whyItMatters,
      });
    }

    rs = Number(rs.toFixed(4));
    const gs: 0 | 1 = blockingVerifiedCount === blockingTotalCount ? 1 : 0;
    // Also respect rule-derived gate_open(stage) if a rule blocked the stage
    const ruleBlockedNoEx = input.facts.has(`effective_gate_open(${st.stage})`);
    const ruleBlockedAny = input.facts.has(`gate_open(${st.stage})`);
    const effectiveGs: 0 | 1 =
      effectiveBlockingSatisfied && !ruleBlockedNoEx ? 1 : 0;
    const finalGs: 0 | 1 = gs === 1 && !ruleBlockedAny ? 1 : 0;

    const scoreHighButGateLocked =
      rs >= input.settings.readiness_threshold && finalGs === 0;

    let statusWord: StageScoreSummary['statusWord'] = 'Not started';
    if (finalGs === 1 && verifiedCount === stageArts.length) {
      statusWord = 'Done';
    } else if (effectiveGs === 0 || input.facts.has(`stage_needs_review(${st.stage})`)) {
      statusWord =
        artefactDetails.every((d) => d.rawStatus === 'Not submitted')
          ? 'Not started'
          : effectiveGs === 0
          ? 'Blocked'
          : 'Needs attention';
    } else if (verifiedCount > 0 || artefactDetails.some((d) => d.rawStatus !== 'Not submitted')) {
      statusWord = 'Needs attention';
    }

    if (effectiveGs === 0) {
      const missingBlocking = artefactDetails
        .filter((a) => a.isBlocking && a.classification !== 'Verified' && !a.coveredByExceptionId)
        .map((a) => `${a.name} (${a.classification})`);
      if (missingBlocking.length > 0) {
        releaseLockedReasons.push(
          `Stage ${st.stage} (${st.name}) gate locked: ${missingBlocking.join(', ')}.`
        );
      } else {
        releaseLockedReasons.push(`Stage ${st.stage} (${st.name}) has an open governance gate.`);
      }
    }

    stageSummaries.push({
      stage: st.stage,
      name: st.name,
      focus: st.focus,
      rs,
      gs: finalGs,
      effectiveGs,
      scoreHighButGateLocked,
      statusWord,
      verifiedCount,
      totalCount: stageArts.length,
      blockingVerifiedCount,
      blockingTotalCount,
      artefactDetails,
    });
  }

  const overallReadiness = Number(
    (
      stageSummaries.reduce((sum, s) => sum + s.rs, 0) / stageSummaries.length
    ).toFixed(4)
  );

  let readinessLabel: AssessmentResult['readinessLabel'] = 'In progress';
  if (overallReadiness === 0) {
    readinessLabel = 'Not started';
  } else if (overallReadiness >= 0.999) {
    readinessLabel = 'Complete';
  } else if (overallReadiness >= input.settings.readiness_threshold) {
    readinessLabel = 'Almost there';
  }

  // Evaluate risks
  const riskSummaries: RiskEvaluationSummary[] = [];
  for (const rDef of RISKS) {
    const reducingArts = ARTEFACTS.filter((a) => a.reducesRisks.includes(rDef.id));
    const allReducingVerified =
      reducingArts.length > 0 &&
      reducingArts.every(
        (a) => input.artefactStatus.get(a.id)?.classification === 'Verified'
      );
    const anyInRemediation = reducingArts.some(
      (a) => input.artefactStatus.get(a.id)?.classification === 'Submitted but unverified'
    );
    const triggeredRules = Array.from(input.triggeredRiskRuleIds.get(rDef.id) ?? []);
    const activeAcc = input.activeAcceptances.find((acc) => acc.risk_id === rDef.id) ?? null;
    const coveringEx =
      input.activeExceptions.find(
        (ex) =>
          (ex.target_type === 'rule' && triggeredRules.includes(ex.target_id)) ||
          (ex.target_type === 'artefact' && reducingArts.some((a) => a.id === ex.target_id))
      ) ?? null;

    let status: RiskStatus = 'Open';
    if (allReducingVerified && triggeredRules.length === 0) {
      status = 'Mitigated';
    } else if (activeAcc && rDef.acceptableUnderPolicy) {
      status = 'Formally Accepted';
    } else if (coveringEx) {
      status = 'Excepted';
    } else if (anyInRemediation) {
      status = 'In remediation';
    } else if (triggeredRules.length === 0 && reducingArts.every((a) => !a.isBlocking) && !rDef.severity.includes('High')) {
      status = allReducingVerified ? 'Mitigated' : 'Open';
    }

    if (status === 'Open' && rDef.severity === 'High' && triggeredRules.length > 0) {
      releaseLockedReasons.push(`High risk open: ${rDef.name}.`);
    }

    riskSummaries.push({
      riskId: rDef.id,
      name: rDef.name,
      description: rDef.description,
      severity: rDef.severity,
      stage: rDef.stage,
      linkedGovernanceRequirement: rDef.linkedGovernanceRequirement,
      acceptableUnderPolicy: rDef.acceptableUnderPolicy,
      status,
      triggeringRuleIds: triggeredRules,
      acceptanceRecordId: activeAcc?.id ?? null,
      exceptionId: coveringEx?.id ?? null,
      plainExplanation: rDef.description,
    });
  }

  const highRiskOpenCount = riskSummaries.filter(
    (r) =>
      r.severity === 'High' &&
      r.status !== 'Mitigated' &&
      r.status !== 'Formally Accepted' &&
      r.triggeringRuleIds.length > 0
  ).length;

  const openRiskCount = riskSummaries.filter(
    (r) => r.status === 'Open' || r.status === 'In remediation'
  ).length;

  const stagesCompleteCount = stageSummaries.filter((s) => s.statusWord === 'Done').length;
  const anyEffectiveGateOpen = stageSummaries.some((s) => s.effectiveGs === 0);
  const anyUnclear = Array.from(input.artefactStatus.values()).some(
    (s) => s.classification === 'Unclear'
  );
  const anyLowConfidence = input.guidanceItems.some((g) => g.needsHumanInspection);

  const releaseLocked = anyEffectiveGateOpen || highRiskOpenCount > 0;

  let releaseStatusBanner = 'NOT READY: High-risk flag open';
  let releaseStatusSentence =
    'Release is locked because one or more high-severity risks or required gates remain open.';

  if (highRiskOpenCount > 0) {
    releaseStatusBanner = 'NOT READY: High-risk flag open';
    releaseStatusSentence =
      'One or more high-severity governance risks are open and must be resolved before release.';
  } else if (anyEffectiveGateOpen) {
    releaseStatusBanner = 'NOT READY: Required stage gate locked';
    releaseStatusSentence =
      'At least one mandatory lifecycle item is missing, expired, or unverified.';
  } else if (
    anyUnclear ||
    anyLowConfidence ||
    input.project.workflow_state !== 'Cleared for Controlled Release'
  ) {
    if (input.project.workflow_state === 'Cleared for Controlled Release' && !releaseLocked) {
      releaseStatusBanner = 'READY FOR CONTROLLED RELEASE';
      releaseStatusSentence =
        'All effective gates are satisfied, no high risk remains open, and reviewer sign-off is complete.';
    } else {
      releaseStatusBanner = 'NEEDS REVIEW';
      releaseStatusSentence =
        input.activeExceptions.length > 0
          ? 'Blocking items are covered by temporary approved exceptions; human review and sign-off are required before release.'
          : 'Automated checks are satisfied or pending verification; human reviewer sign-off is required.';
    }
  } else {
    releaseStatusBanner = 'READY FOR CONTROLLED RELEASE';
    releaseStatusSentence =
      'All effective gates are satisfied, no high risk remains open, and reviewer sign-off is complete.';
  }

  // Deduplicate releaseLockedReasons
  const uniqueLockedReasons = Array.from(new Set(releaseLockedReasons));

  // Top 3 next actions generated from live results
  const nextActions: AssessmentResult['nextActions'] = input.firedRules
    .filter((fr) => fr.ruleType === 'BLOCKING' || fr.ruleType === 'WARNING')
    .slice(0, 3)
    .map((fr, idx) => ({
      priority: idx + 1,
      title: fr.ruleName,
      detail: fr.plainExplanation,
      ruleId: fr.ruleId,
      stage: fr.stage || 1,
    }));

  if (nextActions.length === 0 && input.project.workflow_state !== 'Cleared for Controlled Release') {
    nextActions.push({
      priority: 1,
      title: 'Complete human reviewer sign-off',
      detail: 'All required evidence checks are complete. An assigned reviewer must record sign-off before controlled release.',
      ruleId: 'R10',
      stage: 6,
    });
  }

  return {
    overallReadiness,
    readinessLabel,
    releaseStatusBanner,
    releaseStatusSentence,
    releaseLocked,
    releaseLockedReasons: uniqueLockedReasons,
    highRiskOpenCount,
    openRiskCount,
    stagesCompleteCount,
    stageSummaries,
    riskSummaries,
    nextActions,
  };
}
