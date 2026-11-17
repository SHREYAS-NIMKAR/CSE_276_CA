import { ARTEFACTS } from './knowledge';
import { BenchmarkCase, PolicyClause } from './types';

export interface BaselineCasePrediction {
  predictedMissingArtefacts: string[];
  predictedGates: string[];
  predictedClauseIds: string[];
  lowSpecificityCount: number;
  totalGuidanceCount: number;
  latencyMs: number;
}

const KEYWORD_TO_CLAUSE_TEMPLATES: Array<{
  pattern: RegExp;
  clauseId: string;
  gate?: string;
  isGeneric: boolean;
}> = [
  { pattern: /student|academic|grading|advising|exam|admission/i, clauseId: 'UAIGP-3.1', gate: 'R1', isGeneric: false },
  { pattern: /bias|fairness|subgroup|demographic|cohort/i, clauseId: 'UAIGP-3.2', gate: 'R1', isGeneric: false },
  { pattern: /privacy|personal|pii|consent|datasheet|dataset/i, clauseId: 'UDHS-1.1', gate: 'R2', isGeneric: false },
  { pattern: /automated|autonomous|action|rollback|fallback/i, clauseId: 'UAIGP-5.1', gate: 'R3', isGeneric: false },
  { pattern: /ethics|board|approval|expired|sign-off/i, clauseId: 'UAIGP-6.1', gate: 'R4', isGeneric: false },
  { pattern: /explain|transparent|interpretable|attribution/i, clauseId: 'UAIGP-4.1', isGeneric: false },
  { pattern: /baseline|benchmark|accuracy/i, clauseId: 'UAIGP-2.1', isGeneric: false },
  { pattern: /synthetic|wrapper|third-party|foundation/i, clauseId: 'UAIGP-1.4', isGeneric: true },
  { pattern: /model|ai|system|machine learning|script/i, clauseId: 'EXT-REF-1.1', isGeneric: true },
];

export function runBaselineOnCase(
  bc: BenchmarkCase,
  activeClauses: PolicyClause[]
): BaselineCasePrediction {
  const start = performance.now();

  // Baseline checks only flat checklist (missing/expired status on explicitly flagged items, NO rule chaining, NO R1/R3 context conditions, NO semantic IR)
  const predictedMissingArtefacts: string[] = [];
  for (const art of ARTEFACTS) {
    const snap = bc.evidence_snapshot[art.id];
    // Simple baseline checks only Not submitted / Unclear, often missing expiry or context-dependent rules
    if (!snap || snap.status === 'Not submitted' || snap.status === 'Unclear') {
      if (art.isBlocking) {
        predictedMissingArtefacts.push(art.id);
      }
    }
  }

  // Regex keyword matcher over project title + description + acceptance criteria ONLY (ignores structured dependency rules & fairness calculations)
  const textBlob = `${bc.title} ${bc.description} ${bc.acceptance_criteria}`;
  const activeSet = new Set(activeClauses.map((c) => c.clause_id));
  const matchedClauses = new Set<string>();
  const matchedGates = new Set<string>();
  let lowSpecificityCount = 0;

  for (const tpl of KEYWORD_TO_CLAUSE_TEMPLATES) {
    if (tpl.pattern.test(textBlob)) {
      if (activeSet.has(tpl.clauseId)) {
        matchedClauses.add(tpl.clauseId);
      }
      if (tpl.gate) matchedGates.add(tpl.gate);
      if (tpl.isGeneric) lowSpecificityCount += 1;
    }
  }

  // Static checklist gate fallback: add R2/R4 only if their direct artefacts are Not submitted (misses expiry & fairness failures)
  if (
    bc.evidence_snapshot['dataset_datasheet']?.status === 'Not submitted' ||
    bc.evidence_snapshot['consent_record']?.status === 'Not submitted'
  ) {
    matchedGates.add('R2');
  }
  if (bc.evidence_snapshot['ethics_board_signoff']?.status === 'Not submitted') {
    matchedGates.add('R4');
  }

  // Static fallback template if nothing matched
  if (matchedClauses.size === 0 && activeSet.has('EXT-REF-1.1')) {
    matchedClauses.add('EXT-REF-1.1');
    lowSpecificityCount += 1;
  }

  const latencyMs = Math.max(0.05, Number((performance.now() - start).toFixed(3)));

  return {
    predictedMissingArtefacts,
    predictedGates: Array.from(matchedGates),
    predictedClauseIds: Array.from(matchedClauses),
    lowSpecificityCount,
    totalGuidanceCount: matchedClauses.size,
    latencyMs,
  };
}
