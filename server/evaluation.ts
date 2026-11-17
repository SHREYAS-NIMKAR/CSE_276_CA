import crypto from 'crypto';
import { runBaselineOnCase } from './baseline';
import { DbClient } from './db';
import { ARTEFACTS } from './knowledge';
import { runForwardChainingAssessment } from './ruleEngine';
import {
  BenchmarkCase,
  EvidenceRecord,
  FairnessCheckRecord,
  PolicyClause,
  ProjectRecord,
  RuleDefinition,
  SystemSettings,
} from './types';

export interface MetricSet {
  artefactPrecision: number;
  artefactRecall: number;
  artefactF1: number;
  gatePrecision: number;
  gateRecall: number;
  gateF1: number;
  citationGroundingAccuracy: number;
  lowSpecificityRate: number;
  meanLatencyMs: number;
}

export interface FailureCaseNote {
  caseId: string;
  title: string;
  category: string;
  reason: string;
}

export interface EvaluationRunSummary {
  runId: string;
  sampleSize: number;
  perCategoryCounts: { normal: number; edge: number; incomplete: number };
  governanceSystem: MetricSet;
  baselineSystem: MetricSet;
  deltas: Record<keyof MetricSet, number>;
  perCategory: Record<
    'normal' | 'edge' | 'incomplete',
    {
      count: number;
      governanceF1: number;
      baselineF1: number;
      governanceGateF1: number;
      baselineGateF1: number;
      governanceCitationAccuracy: number;
      baselineCitationAccuracy: number;
    }
  >;
  failureAnalysis: {
    falsePositives: FailureCaseNote[];
    falseNegatives: FailureCaseNote[];
    retrievalFailures: FailureCaseNote[];
    twoHopCases: FailureCaseNote[];
  };
  plainSummary: string;
  createdAt: string;
}

function computeSetPRF1(
  pairs: Array<{ predicted: Set<string>; truth: Set<string> }>
): { precision: number; recall: number; f1: number } {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let allEmptyMatches = 0;

  for (const { predicted, truth } of pairs) {
    if (predicted.size === 0 && truth.size === 0) {
      allEmptyMatches += 1;
    }
    for (const p of predicted) {
      if (truth.has(p)) tp += 1;
      else fp += 1;
    }
    for (const t of truth) {
      if (!predicted.has(t)) fn += 1;
    }
  }

  // If both total predicted and truth are empty across all cases (unlikely across 36 cases), treat as 1
  if (tp + fp === 0 && tp + fn === 0) {
    return allEmptyMatches === pairs.length
      ? { precision: 1, recall: 1, f1: 1 }
      : { precision: 0, recall: 0, f1: 0 };
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
  };
}

function compareVerdict(delta: number, higherIsBetter = true): string {
  const effective = higherIsBetter ? delta : -delta;
  if (effective > 0.05) return 'better';
  if (effective < -0.05) return 'worse';
  return 'similar';
}

export async function runBenchmarkEvaluation(
  db: DbClient,
  triggeredByUserId: string | null
): Promise<{ summary: EvaluationRunSummary; perCase: unknown[] }> {
  const settings = await db.get<SystemSettings>(`SELECT * FROM settings WHERE id = 1`);
  if (!settings) throw new Error('Settings missing.');

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
  }>(`SELECT * FROM rules ORDER BY priority DESC`);
  const rules: RuleDefinition[] = rulesRaw.map((r) => ({
    ...r,
    dependencies: JSON.parse(r.dependencies_json),
    enabled: Boolean(r.enabled),
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
  }>(`SELECT * FROM policy_clauses ORDER BY clause_id ASC`);
  const clauses: PolicyClause[] = clausesRaw.map((c) => ({
    ...c,
    tags: JSON.parse(c.tags_json),
    related_clause_ids: JSON.parse(c.related_clause_ids_json),
    is_active: Boolean(c.is_active),
    is_demo: Boolean(c.is_demo),
  }));
  const activeClauses = clauses.filter((c) => c.is_active);

  const rawCases = await db.query<{
    id: string;
    category: BenchmarkCase['category'];
    title: string;
    description: string;
    assumptions_json: string;
    acceptance_criteria: string;
    evidence_snapshot_json: string;
    ground_truth_missing_json: string;
    ground_truth_gates_json: string;
    ground_truth_clauses_json: string;
    needs_two_hop: number | boolean;
    is_demo: number | boolean;
  }>(`SELECT * FROM benchmark_cases ORDER BY category, id`);

  const cases: BenchmarkCase[] = rawCases.map((rc) => ({
    id: rc.id,
    category: rc.category,
    title: rc.title,
    description: rc.description,
    assumptions: JSON.parse(rc.assumptions_json),
    acceptance_criteria: rc.acceptance_criteria,
    evidence_snapshot: JSON.parse(rc.evidence_snapshot_json),
    ground_truth_missing_artefacts: JSON.parse(rc.ground_truth_missing_json),
    ground_truth_gates: JSON.parse(rc.ground_truth_gates_json),
    ground_truth_clause_ids: JSON.parse(rc.ground_truth_clauses_json),
    needs_two_hop: Boolean(rc.needs_two_hop),
    is_demo: Boolean(rc.is_demo),
  }));

  const now = new Date();
  const govArtPairs: Array<{ predicted: Set<string>; truth: Set<string>; category: BenchmarkCase['category'] }> = [];
  const baseArtPairs: Array<{ predicted: Set<string>; truth: Set<string>; category: BenchmarkCase['category'] }> = [];
  const govGatePairs: Array<{ predicted: Set<string>; truth: Set<string>; category: BenchmarkCase['category'] }> = [];
  const baseGatePairs: Array<{ predicted: Set<string>; truth: Set<string>; category: BenchmarkCase['category'] }> = [];

  let govCitationHits = 0;
  let govCitationTotal = 0;
  let baseCitationHits = 0;
  let baseCitationTotal = 0;
  let govLowSpecCount = 0;
  let govTotalGuidance = 0;
  let baseLowSpecCount = 0;
  let baseTotalGuidance = 0;
  let govTotalMs = 0;
  let baseTotalMs = 0;

  const falsePositives: FailureCaseNote[] = [];
  const falseNegatives: FailureCaseNote[] = [];
  const retrievalFailures: FailureCaseNote[] = [];
  const twoHopCases: FailureCaseNote[] = [];
  const perCaseResults: unknown[] = [];

  const catCitation: Record<'normal' | 'edge' | 'incomplete', { govH: number; govT: number; baseH: number; baseT: number }> = {
    normal: { govH: 0, govT: 0, baseH: 0, baseT: 0 },
    edge: { govH: 0, govT: 0, baseH: 0, baseT: 0 },
    incomplete: { govH: 0, govT: 0, baseH: 0, baseT: 0 },
  };

  for (const bc of cases) {
    // Construct synthetic project + evidence objects from benchmark case (never writes to projects table)
    const projectObj: ProjectRecord = {
      id: bc.id,
      name: bc.title,
      description: bc.description,
      owner_id: 'bench-owner',
      assigned_reviewer_id: 'bench-reviewer',
      deployment_autonomy: bc.assumptions.deployment_autonomy,
      affects_academic_standing: bc.assumptions.affects_academic_standing,
      data_sensitivity: bc.assumptions.data_sensitivity,
      uses_synthetic_data: bc.assumptions.uses_synthetic_data,
      uses_third_party_wrapper: bc.assumptions.uses_third_party_wrapper,
      is_low_risk_admin_script: bc.assumptions.is_low_risk_admin_script,
      target_user_population: bc.assumptions.target_user_population,
      workflow_state: 'Draft',
      is_demo: true,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    const evidenceList: EvidenceRecord[] = ARTEFACTS.map((art) => {
      const snap = bc.evidence_snapshot[art.id];
      const expiredIso = snap?.expired
        ? new Date(now.getTime() - 10 * 86400 * 1000).toISOString()
        : null;
      return {
        id: `${bc.id}-${art.id}`,
        project_id: bc.id,
        artefact_id: art.id,
        status: snap?.status ?? 'Not submitted',
        notes: '',
        file_name: null,
        file_path: null,
        file_size: null,
        file_checksum: null,
        external_link: null,
        expiry_date: expiredIso,
        missingness_pct: snap?.missingness_pct ?? null,
        updated_by: null,
        updated_at: now.toISOString(),
      };
    });

    const subSnap = bc.evidence_snapshot['subgroup_error_matrix'];
    const fairnessPass = subSnap?.fairness_pass !== false && subSnap?.status === 'Verified';
    const fairnessCheck: FairnessCheckRecord = {
      project_id: bc.id,
      metric_name: 'F1',
      cohorts: [
        { cohort: 'Cohort A', metricName: 'F1', value: 0.88 },
        { cohort: 'Cohort B', metricName: 'F1', value: fairnessPass ? 0.86 : 0.72 },
      ],
      max_gap: fairnessPass ? 0.02 : 0.16,
      tolerance_used: settings.parity_tolerance,
      passed: fairnessPass,
      checked_at: now.toISOString(),
    };

    // 1. Run Governance System
    const t0 = performance.now();
    const assessment = runForwardChainingAssessment({
      project: projectObj,
      evidence: evidenceList,
      fairnessCheck,
      exceptions: [],
      riskAcceptances: [],
      rules,
      clauses,
      settings,
      now,
    });
    const govMs = Number((performance.now() - t0).toFixed(3));
    govTotalMs += govMs;

    const govPredictedMissing = new Set<string>();
    for (const st of assessment.stageSummaries) {
      for (const a of st.artefactDetails) {
        if (a.classification !== 'Verified' && a.isBlocking) {
          govPredictedMissing.add(a.artefactId);
        }
      }
    }
    // Also add non-blocking target artefacts surfaced by fired rules
    for (const fr of assessment.firedRules) {
      if (fr.ruleType === 'BLOCKING' || fr.ruleType === 'WARNING') {
        for (const aid of fr.targetArtefacts) {
          govPredictedMissing.add(aid);
        }
      }
    }

    const govPredictedGates = new Set(
      assessment.firedRules
        .filter((fr) => fr.ruleType === 'BLOCKING')
        .map((fr) => fr.ruleId)
    );

    const govPredictedClauses = new Set<string>();
    for (const g of assessment.guidanceItems) {
      govTotalGuidance += 1;
      if (g.needsHumanInspection) govLowSpecCount += 1;
      for (const c of g.clauses) {
        govPredictedClauses.add(c.clauseId);
        for (const rc of c.relatedClauses) {
          govPredictedClauses.add(rc.clauseId);
        }
      }
    }

    // 2. Run Baseline System
    const basePred = runBaselineOnCase(bc, activeClauses);
    baseTotalMs += basePred.latencyMs;
    baseLowSpecCount += basePred.lowSpecificityCount;
    baseTotalGuidance += basePred.totalGuidanceCount;

    const truthMissing = new Set(bc.ground_truth_missing_artefacts);
    const truthGates = new Set(bc.ground_truth_gates);
    const truthClauses = new Set(bc.ground_truth_clause_ids);

    govArtPairs.push({ predicted: govPredictedMissing, truth: truthMissing, category: bc.category });
    baseArtPairs.push({
      predicted: new Set(basePred.predictedMissingArtefacts),
      truth: truthMissing,
      category: bc.category,
    });

    govGatePairs.push({ predicted: govPredictedGates, truth: truthGates, category: bc.category });
    baseGatePairs.push({
      predicted: new Set(basePred.predictedGates),
      truth: truthGates,
      category: bc.category,
    });

    // Citation grounding accuracy against ground truth clauses
    if (truthClauses.size > 0) {
      govCitationTotal += truthClauses.size;
      baseCitationTotal += truthClauses.size;
      catCitation[bc.category].govT += truthClauses.size;
      catCitation[bc.category].baseT += truthClauses.size;

      let caseGovHits = 0;
      for (const tc of truthClauses) {
        if (govPredictedClauses.has(tc)) {
          govCitationHits += 1;
          catCitation[bc.category].govH += 1;
          caseGovHits += 1;
        }
        if (basePred.predictedClauseIds.includes(tc)) {
          baseCitationHits += 1;
          catCitation[bc.category].baseH += 1;
        }
      }

      if (caseGovHits < truthClauses.size) {
        const missed = Array.from(truthClauses).filter((c) => !govPredictedClauses.has(c));
        retrievalFailures.push({
          caseId: bc.id,
          title: bc.title,
          category: bc.category,
          reason: `Missed ground-truth policy clause(s): ${missed.join(', ')}.`,
        });
      }
    }

    // Failure analysis for FP/FN on gates & missing artefacts
    const fpGates = Array.from(govPredictedGates).filter((g) => !truthGates.has(g));
    const fnGates = Array.from(truthGates).filter((g) => !govPredictedGates.has(g));
    const fnArts = Array.from(truthMissing).filter((a) => !govPredictedMissing.has(a));
    if (fpGates.length > 0) {
      falsePositives.push({
        caseId: bc.id,
        title: bc.title,
        category: bc.category,
        reason: `Governance system flagged gate(s) ${fpGates.join(', ')} not in independent ground truth.`,
      });
    }
    if (fnGates.length > 0 || fnArts.length > 0) {
      falseNegatives.push({
        caseId: bc.id,
        title: bc.title,
        category: bc.category,
        reason: `Missed expected items: ${[...fnGates, ...fnArts].join(', ')}.`,
      });
    }
    if (bc.needs_two_hop) {
      twoHopCases.push({
        caseId: bc.id,
        title: bc.title,
        category: bc.category,
        reason: `Requires two-hop policy link from primary retrieved clause to secondary compliance clause.`,
      });
    }

    perCaseResults.push({
      id: bc.id,
      category: bc.category,
      title: bc.title,
      govMissingCount: govPredictedMissing.size,
      truthMissingCount: truthMissing.size,
      govGates: Array.from(govPredictedGates),
      baseGates: basePred.predictedGates,
      truthGates: bc.ground_truth_gates,
      govLatencyMs: govMs,
      baseLatencyMs: basePred.latencyMs,
    });
  }

  const govArtPRF = computeSetPRF1(govArtPairs);
  const baseArtPRF = computeSetPRF1(baseArtPairs);
  const govGatePRF = computeSetPRF1(govGatePairs);
  const baseGatePRF = computeSetPRF1(baseGatePairs);

  const govMetrics: MetricSet = {
    artefactPrecision: govArtPRF.precision,
    artefactRecall: govArtPRF.recall,
    artefactF1: govArtPRF.f1,
    gatePrecision: govGatePRF.precision,
    gateRecall: govGatePRF.recall,
    gateF1: govGatePRF.f1,
    citationGroundingAccuracy:
      govCitationTotal > 0 ? Number((govCitationHits / govCitationTotal).toFixed(4)) : 1,
    lowSpecificityRate:
      govTotalGuidance > 0 ? Number((govLowSpecCount / govTotalGuidance).toFixed(4)) : 0,
    meanLatencyMs: cases.length > 0 ? Number((govTotalMs / cases.length).toFixed(3)) : 0,
  };

  const baseMetrics: MetricSet = {
    artefactPrecision: baseArtPRF.precision,
    artefactRecall: baseArtPRF.recall,
    artefactF1: baseArtPRF.f1,
    gatePrecision: baseGatePRF.precision,
    gateRecall: baseGatePRF.recall,
    gateF1: baseGatePRF.f1,
    citationGroundingAccuracy:
      baseCitationTotal > 0 ? Number((baseCitationHits / baseCitationTotal).toFixed(4)) : 1,
    lowSpecificityRate:
      baseTotalGuidance > 0 ? Number((baseLowSpecCount / baseTotalGuidance).toFixed(4)) : 0,
    meanLatencyMs: cases.length > 0 ? Number((baseTotalMs / cases.length).toFixed(3)) : 0,
  };

  const deltas: Record<keyof MetricSet, number> = {
    artefactPrecision: Number((govMetrics.artefactPrecision - baseMetrics.artefactPrecision).toFixed(4)),
    artefactRecall: Number((govMetrics.artefactRecall - baseMetrics.artefactRecall).toFixed(4)),
    artefactF1: Number((govMetrics.artefactF1 - baseMetrics.artefactF1).toFixed(4)),
    gatePrecision: Number((govMetrics.gatePrecision - baseMetrics.gatePrecision).toFixed(4)),
    gateRecall: Number((govMetrics.gateRecall - baseMetrics.gateRecall).toFixed(4)),
    gateF1: Number((govMetrics.gateF1 - baseMetrics.gateF1).toFixed(4)),
    citationGroundingAccuracy: Number(
      (govMetrics.citationGroundingAccuracy - baseMetrics.citationGroundingAccuracy).toFixed(4)
    ),
    lowSpecificityRate: Number((govMetrics.lowSpecificityRate - baseMetrics.lowSpecificityRate).toFixed(4)),
    meanLatencyMs: Number((govMetrics.meanLatencyMs - baseMetrics.meanLatencyMs).toFixed(3)),
  };

  const perCategory = (['normal', 'edge', 'incomplete'] as const).reduce(
    (acc, cat) => {
      const gArt = computeSetPRF1(govArtPairs.filter((p) => p.category === cat));
      const bArt = computeSetPRF1(baseArtPairs.filter((p) => p.category === cat));
      const gGate = computeSetPRF1(govGatePairs.filter((p) => p.category === cat));
      const bGate = computeSetPRF1(baseGatePairs.filter((p) => p.category === cat));
      const cc = catCitation[cat];
      acc[cat] = {
        count: govArtPairs.filter((p) => p.category === cat).length,
        governanceF1: gArt.f1,
        baselineF1: bArt.f1,
        governanceGateF1: gGate.f1,
        baselineGateF1: bGate.f1,
        governanceCitationAccuracy: cc.govT > 0 ? Number((cc.govH / cc.govT).toFixed(4)) : 1,
        baselineCitationAccuracy: cc.baseT > 0 ? Number((cc.baseH / cc.baseT).toFixed(4)) : 1,
      };
      return acc;
    },
    {} as EvaluationRunSummary['perCategory']
  );

  const gateVerdict = compareVerdict(deltas.gateF1, true);
  const artVerdict = compareVerdict(deltas.artefactF1, true);
  const citeVerdict = compareVerdict(deltas.citationGroundingAccuracy, true);
  const latVerdict = compareVerdict(deltas.meanLatencyMs, false);

  const plainSummary =
    `Across ${cases.length} demonstration cases (12 per category), the governance engine performed ${artVerdict} on missing-artefact detection ` +
    `(F1 ${(govMetrics.artefactF1 * 100).toFixed(1)}% vs baseline ${(baseMetrics.artefactF1 * 100).toFixed(1)}%), ` +
    `${gateVerdict} on release-gate accuracy (F1 ${(govMetrics.gateF1 * 100).toFixed(1)}% vs ${(baseMetrics.gateF1 * 100).toFixed(1)}%), ` +
    `and ${citeVerdict} on citation grounding (${(govMetrics.citationGroundingAccuracy * 100).toFixed(1)}% vs ${(baseMetrics.citationGroundingAccuracy * 100).toFixed(1)}%), ` +
    `with ${latVerdict} average runtime (${govMetrics.meanLatencyMs.toFixed(2)} ms vs ${baseMetrics.meanLatencyMs.toFixed(2)} ms).`;

  const runId = `EVAL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const createdAt = new Date().toISOString();

  const summary: EvaluationRunSummary = {
    runId,
    sampleSize: cases.length,
    perCategoryCounts: {
      normal: perCategory.normal.count,
      edge: perCategory.edge.count,
      incomplete: perCategory.incomplete.count,
    },
    governanceSystem: govMetrics,
    baselineSystem: baseMetrics,
    deltas,
    perCategory,
    failureAnalysis: {
      falsePositives,
      falseNegatives,
      retrievalFailures,
      twoHopCases,
    },
    plainSummary,
    createdAt,
  };

  await db.execute(
    `INSERT INTO evaluation_runs (id, run_by, settings_json, summary_json, per_case_json, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      triggeredByUserId ?? 'system',
      JSON.stringify(settings),
      JSON.stringify(summary),
      JSON.stringify(perCaseResults),
      1,
      createdAt,
    ]
  );

  return { summary, perCase: perCaseResults };
}
