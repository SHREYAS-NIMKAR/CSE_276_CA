import {
  AssessmentResult,
  EvidenceItem,
  FairnessCheck,
  ProjectItem,
  SystemSettings,
} from '../types';

export type SuggestedTab = 'evidence' | 'risks' | 'review' | 'export';

export interface SuggestionStep {
  stepNumber: number;
  title: string;
  description: string;
  actionLabel: string;
  targetTab: SuggestedTab;
}

export interface OverallSuggestion {
  tone: 'ready' | 'attention' | 'blocked';
  headline: string;
  plainSummary: string;
  counts: {
    verified: number;
    awaitingVerification: number;
    remaining: number;
    total: number;
    blockingRemaining: number;
  };
  steps: SuggestionStep[];
}

export function buildOverallSuggestion(params: {
  assessment: AssessmentResult;
  evidence?: EvidenceItem[];
  fairnessCheck?: FairnessCheck | null;
  project?: ProjectItem | null;
  settings?: SystemSettings;
}): OverallSuggestion {
  const { assessment, evidence = [], fairnessCheck = null, project = null, settings } = params;

  const allDetails = assessment.stageSummaries.flatMap((s) => s.artefactDetails);
  const total = allDetails.length;
  const verified = allDetails.filter((d) => d.classification === 'Verified' && d.inDate).length;
  const awaitingVerification = allDetails.filter(
    (d) => d.classification === 'Submitted but unverified' || d.classification === 'Unclear'
  ).length;
  const remaining = Math.max(0, total - verified - awaitingVerification);

  const missingBlocking = allDetails.filter(
    (d) => d.isBlocking && d.classification !== 'Verified' && !d.coveredByExceptionId
  );
  const expiredItems = allDetails.filter((d) => d.classification === 'Expired');
  const unclearItems = allDetails.filter((d) => d.classification === 'Unclear');

  const missingnessThresholdPct = ((settings?.missingness_threshold ?? 0.05) * 100).toFixed(1);
  const parityTolerance = settings?.parity_tolerance ?? 0.05;
  const schemaEv = evidence.find((e) => e.artefact_id === 'schema_profile');
  const missingnessTooHigh =
    schemaEv?.missingness_pct !== null &&
    schemaEv?.missingness_pct !== undefined &&
    schemaEv.missingness_pct > (settings?.missingness_threshold ?? 0.05);

  const fairnessFailed = Boolean(fairnessCheck && !fairnessCheck.passed);
  const readinessPct = Math.round(assessment.overallReadiness * 100);
  const scoreHighGateLocked = assessment.stageSummaries.some((s) => s.scoreHighButGateLocked);

  const steps: SuggestionStep[] = [];

  // 1. Numeric quality / fairness threshold blockers
  if (missingnessTooHigh && schemaEv?.missingness_pct !== undefined && schemaEv?.missingness_pct !== null) {
    steps.push({
      stepNumber: steps.length + 1,
      title: `Lower dataset missingness below ${missingnessThresholdPct}%`,
      description: `Your Schema Profile reports ${(schemaEv.missingness_pct * 100).toFixed(1)}% missing values. Clean or impute missing data and update Schema Profile under Evidence.`,
      actionLabel: 'Fix in Evidence',
      targetTab: 'evidence',
    });
  }

  if (fairnessFailed && fairnessCheck) {
    steps.push({
      stepNumber: steps.length + 1,
      title: `Close subgroup fairness gap (max ${(parityTolerance * 100).toFixed(0)}%)`,
      description:
        fairnessCheck.max_gap !== null
          ? `Your fairness gap is ${(fairnessCheck.max_gap * 100).toFixed(1)}%, which exceeds the ${((fairnessCheck.tolerance_used ?? parityTolerance) * 100).toFixed(1)}% limit. Re-test cohorts under Evidence.`
          : 'Complete your subgroup fairness parity check with at least 2 cohorts under Evidence.',
      actionLabel: 'Check Fairness',
      targetTab: 'evidence',
    });
  }

  // 2. Expired or unclear evidence
  if (expiredItems.length > 0 && steps.length < 3) {
    const names = expiredItems.slice(0, 2).map((d) => d.name).join(', ');
    steps.push({
      stepNumber: steps.length + 1,
      title: `Renew expired approval (${names})`,
      description: `${expiredItems.length} item(s) passed their expiry date (${names}). Update the document and expiry date under Evidence.`,
      actionLabel: 'Update Evidence',
      targetTab: 'evidence',
    });
  }

  if (unclearItems.length > 0 && steps.length < 3) {
    const names = unclearItems.slice(0, 2).map((d) => d.name).join(', ');
    steps.push({
      stepNumber: steps.length + 1,
      title: `Clarify items marked Unclear (${names})`,
      description: `Add clearer notes or upload supporting files for ${names} so a reviewer can verify them.`,
      actionLabel: 'Open Evidence',
      targetTab: 'evidence',
    });
  }

  // 3. Mandatory blocking items waiting for verification vs not submitted
  const blockingSubmitted = missingBlocking.filter(
    (d) => d.classification === 'Submitted but unverified'
  );
  const blockingNotSubmitted = missingBlocking.filter(
    (d) => d.classification === 'Not submitted'
  );

  if (blockingNotSubmitted.length > 0 && steps.length < 3) {
    const names = blockingNotSubmitted.slice(0, 3).map((d) => d.name).join(', ');
    const more = blockingNotSubmitted.length > 3 ? ` (+${blockingNotSubmitted.length - 3} more)` : '';
    steps.push({
      stepNumber: steps.length + 1,
      title: `Submit ${blockingNotSubmitted.length} required blocking item${blockingNotSubmitted.length > 1 ? 's' : ''}`,
      description: `Add notes, a link, or a file and set status to Submitted for: ${names}${more}.`,
      actionLabel: 'Go to Evidence',
      targetTab: 'evidence',
    });
  }

  if (blockingSubmitted.length > 0 && steps.length < 3) {
    const names = blockingSubmitted.slice(0, 3).map((d) => d.name).join(', ');
    steps.push({
      stepNumber: steps.length + 1,
      title: `Verify ${blockingSubmitted.length} submitted blocking item${blockingSubmitted.length > 1 ? 's' : ''}`,
      description: `These were already submitted and just need a Reviewer or Admin to mark them Verified: ${names}.`,
      actionLabel: 'Review in Evidence',
      targetTab: 'evidence',
    });
  }

  // 4. Non-blocking submitted items waiting for verification
  const nonBlockingSubmitted = allDetails.filter(
    (d) => !d.isBlocking && d.classification === 'Submitted but unverified'
  );
  if (nonBlockingSubmitted.length > 0 && steps.length < 3 && !assessment.releaseLocked) {
    steps.push({
      stepNumber: steps.length + 1,
      title: `Verify ${nonBlockingSubmitted.length} remaining submitted item${nonBlockingSubmitted.length > 1 ? 's' : ''}`,
      description: `Marking submitted items Verified raises your overall readiness score from ${readinessPct}%.`,
      actionLabel: 'Open Evidence',
      targetTab: 'evidence',
    });
  }

  // 5. High risk open requiring mitigation or RAA acceptance
  if (assessment.highRiskOpenCount > 0 && steps.length < 3) {
    steps.push({
      stepNumber: steps.length + 1,
      title: `Resolve ${assessment.highRiskOpenCount} open high-severity risk${assessment.highRiskOpenCount > 1 ? 's' : ''}`,
      description:
        'Verify the missing safeguards above, request a temporary exception, or ask the Risk Acceptance Authority to review.',
      actionLabel: 'View Risks',
      targetTab: 'risks',
    });
  }

  // 6. All blocking checks clear -> Human sign-off or Export
  const isCleared = project?.workflow_state === 'Cleared for Controlled Release' && !assessment.releaseLocked;
  if (!assessment.releaseLocked && !isCleared && steps.length < 3) {
    steps.push({
      stepNumber: steps.length + 1,
      title: 'Complete final reviewer sign-off',
      description:
        'All mandatory gates are satisfied. Go to Review and Exceptions to submit for review or record final clearance.',
      actionLabel: 'Go to Sign-Off',
      targetTab: 'review',
    });
  }

  if (isCleared && steps.length === 0) {
    steps.push({
      stepNumber: 1,
      title: 'Download your readiness report',
      description:
        'Everything is verified and cleared for release. Export the signed PDF report or CSV evidence summary for your records.',
      actionLabel: 'Report & Export',
      targetTab: 'export',
    });
  }

  // Fall back to server nextActions if somehow steps remained empty while locked
  if (steps.length === 0 && assessment.nextActions.length > 0) {
    for (const act of assessment.nextActions.slice(0, 3)) {
      steps.push({
        stepNumber: steps.length + 1,
        title: act.title,
        description: act.detail,
        actionLabel: 'Open Evidence',
        targetTab: 'evidence',
      });
    }
  }

  // Build plain-English headline & summary
  let tone: OverallSuggestion['tone'] = 'attention';
  let headline = '';
  let plainSummary = '';

  if (isCleared) {
    tone = 'ready';
    headline = `Ready for release — ${readinessPct}% readiness achieved with all mandatory checks verified.`;
    plainSummary = `${verified} of ${total} lifecycle items are verified and no high-severity risks remain open. You can export your final governance report anytime.`;
  } else if (!assessment.releaseLocked) {
    tone = 'attention';
    headline = `Checks passed (${readinessPct}% ready) — final human sign-off is the last step.`;
    plainSummary = `${verified} of ${total} items are verified${awaitingVerification > 0 ? ` and ${awaitingVerification} more are awaiting reviewer verification` : ''}. No blocking gates are holding release back.`;
  } else if (scoreHighGateLocked) {
    tone = 'blocked';
    headline = `Strong overall score (${readinessPct}%), but ${missingBlocking.length || 1} critical check still blocks release.`;
    plainSummary = `${verified} of ${total} items are verified, which meets the readiness target, but release stays locked until every mandatory blocking check (or numeric threshold) passes.`;
  } else if (verified === 0 && awaitingVerification > 0) {
    tone = 'blocked';
    headline = `${awaitingVerification} item${awaitingVerification > 1 ? 's' : ''} submitted — waiting for a Reviewer to mark them Verified.`;
    plainSummary = `Items marked "Submitted" do not count toward your ${readinessPct}% score until verified by a Reviewer or Admin. Focus on the ${steps.length} step${steps.length === 1 ? '' : 's'} below first.`;
  } else {
    tone = 'blocked';
    const blockerCount = Math.max(missingBlocking.length, assessment.highRiskOpenCount, 1);
    headline = `Not ready yet (${readinessPct}% ready) — ${blockerCount} critical item${blockerCount > 1 ? 's are' : ' is'} locking release.`;
    plainSummary = `Out of ${total} total lifecycle checks, ${verified} ${verified === 1 ? 'is' : 'are'} verified${awaitingVerification > 0 ? `, ${awaitingVerification} submitted awaiting verification,` : ''} and ${remaining} not started. You don't need to finish everything at once — follow the top steps below first.`;
  }

  return {
    tone,
    headline,
    plainSummary,
    counts: {
      verified,
      awaitingVerification,
      remaining,
      total,
      blockingRemaining: missingBlocking.length,
    },
    steps,
  };
}
