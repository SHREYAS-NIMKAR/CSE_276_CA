import React, { useEffect, useState } from 'react';
import { Download, Play } from 'lucide-react';
import { apiRequest, downloadAuthedFile } from '../api';
import { User } from '../types';
import { DemoTag } from './UiPrimitives';

interface EvalMetricSet {
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

interface FailureNote {
  caseId: string;
  title: string;
  category: string;
  reason: string;
}

interface EvalRunRecord {
  id: string;
  created_at: string;
  is_demo: boolean;
  summary: {
    runId: string;
    sampleSize: number;
    perCategoryCounts: { normal: number; edge: number; incomplete: number };
    governanceSystem: EvalMetricSet;
    baselineSystem: EvalMetricSet;
    deltas: Record<keyof EvalMetricSet, number>;
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
      falsePositives: FailureNote[];
      falseNegatives: FailureNote[];
      retrievalFailures: FailureNote[];
      twoHopCases: FailureNote[];
    };
    plainSummary: string;
  };
}

export function EvaluationView({ user }: { user: User }) {
  const [runs, setRuns] = useState<EvalRunRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRuns() {
    try {
      const res = await apiRequest<{ runs: EvalRunRecord[] }>('/evaluation/runs');
      setRuns(res.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load evaluation runs.');
    }
  }

  useEffect(() => {
    loadRuns();
  }, []);

  async function handleRunEvaluation() {
    setRunning(true);
    setError(null);
    try {
      await apiRequest('/evaluation/run', { method: 'POST' });
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run benchmark evaluation.');
    } finally {
      setRunning(false);
    }
  }

  const latest = runs[0]?.summary ?? null;
  const canRun = user.role === 'REVIEWER' || user.role === 'ADMIN';

  const chartMetrics: Array<{ label: string; gov: number; base: number }> = latest
    ? [
        {
          label: 'Artefact F1',
          gov: latest.governanceSystem.artefactF1,
          base: latest.baselineSystem.artefactF1,
        },
        {
          label: 'Gate F1',
          gov: latest.governanceSystem.gateF1,
          base: latest.baselineSystem.gateF1,
        },
        {
          label: 'Gate Recall',
          gov: latest.governanceSystem.gateRecall,
          base: latest.baselineSystem.gateRecall,
        },
        {
          label: 'Citation Acc.',
          gov: latest.governanceSystem.citationGroundingAccuracy,
          base: latest.baselineSystem.citationGroundingAccuracy,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0B2545]">
            Benchmark Evaluation (Governance Engine vs Baseline)
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Ground truth is defined independently of the system under test (n = 36: 12 normal, 12 edge, 12 incomplete).
          </p>
        </div>

        <div className="flex items-center gap-3">
          {latest && (
            <button
              type="button"
              onClick={() =>
                downloadAuthedFile(
                  `/evaluation/runs/${latest.runId}/export.csv`,
                  `evaluation-${latest.runId}.csv`
                ).catch((e) => setError(e instanceof Error ? e.message : 'Export failed.'))
              }
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 bg-white text-sm font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
          )}
          {canRun && (
            <button
              type="button"
              onClick={handleRunEvaluation}
              disabled={running}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] disabled:opacity-60 cursor-pointer"
            >
              <Play className="w-4 h-4" />
              {running ? 'Running 36 cases...' : 'Run evaluation'}
            </button>
          )}
        </div>
      </div>

      {/* Honesty Notice (Section 15C & 16H) */}
      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
        Small demonstration test (n = 36, 12 per category). It does not prove the system works the same way in the real world.
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-900">
          {error}
        </div>
      )}

      {!latest ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
          <h2 className="text-lg font-bold text-[#0B2545]">No Evaluation Runs Recorded Yet</h2>
          <p className="text-sm text-slate-600">
            Click &ldquo;Run evaluation&rdquo; to execute both the forward-chaining governance system and the regex baseline on all 36 benchmark cases.
          </p>
        </div>
      ) : (
        <>
          {/* Dynamic Plain-Language Summary */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h2 className="text-base font-bold text-[#0B2545]">
                Computed Comparison Summary (n = {latest.sampleSize})
              </h2>
              <DemoTag isDemo />
            </div>
            <p className="text-base text-slate-800">{latest.plainSummary}</p>
          </div>

          {/* Side-by-Side Table + Inline SVG Bar Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                  <tr>
                    <th className="py-3 px-4">Metric (n = 36)</th>
                    <th className="py-3 px-4 text-right">Governance</th>
                    <th className="py-3 px-4 text-right">Baseline</th>
                    <th className="py-3 px-4 text-right">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 tabular-nums">
                  {[
                    [
                      'Missing-Artefact Precision',
                      'Precision: how many flagged items were truly missing',
                      latest.governanceSystem.artefactPrecision,
                      latest.baselineSystem.artefactPrecision,
                      latest.deltas.artefactPrecision,
                      true,
                    ],
                    [
                      'Missing-Artefact Recall',
                      'Recall: how many of the real missing items were found',
                      latest.governanceSystem.artefactRecall,
                      latest.baselineSystem.artefactRecall,
                      latest.deltas.artefactRecall,
                      true,
                    ],
                    [
                      'Missing-Artefact F1',
                      'Balanced score combining artefact precision and recall',
                      latest.governanceSystem.artefactF1,
                      latest.baselineSystem.artefactF1,
                      latest.deltas.artefactF1,
                      true,
                    ],
                    [
                      'Risk-Gate Precision',
                      'Precision: how many triggered release gates were truly applicable',
                      latest.governanceSystem.gatePrecision,
                      latest.baselineSystem.gatePrecision,
                      latest.deltas.gatePrecision,
                      true,
                    ],
                    [
                      'Risk-Gate Recall',
                      'Recall: how many real blocking release gates were caught',
                      latest.governanceSystem.gateRecall,
                      latest.baselineSystem.gateRecall,
                      latest.deltas.gateRecall,
                      true,
                    ],
                    [
                      'Risk-Gate F1',
                      'Balanced score for release-gate detection',
                      latest.governanceSystem.gateF1,
                      latest.baselineSystem.gateF1,
                      latest.deltas.gateF1,
                      true,
                    ],
                    [
                      'Citation Grounding Accuracy',
                      'Share of expected policy clauses retrieved in grounded guidance',
                      latest.governanceSystem.citationGroundingAccuracy,
                      latest.baselineSystem.citationGroundingAccuracy,
                      latest.deltas.citationGroundingAccuracy,
                      true,
                    ],
                    [
                      'Low-Specificity Guidance Rate',
                      'Share of guidance falling back to generic or low-confidence items',
                      latest.governanceSystem.lowSpecificityRate,
                      latest.baselineSystem.lowSpecificityRate,
                      latest.deltas.lowSpecificityRate,
                      true,
                    ],
                  ].map(([name, desc, gv, bv, dv]) => (
                    <tr key={String(name)}>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">{name}</div>
                        <div className="text-xs text-slate-500">{desc}</div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold">
                        {(Number(gv) * 100).toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-600">
                        {(Number(bv) * 100).toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">
                        {Number(dv) >= 0 ? '+' : ''}
                        {(Number(dv) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900">Mean Latency (ms)</div>
                      <div className="text-xs text-slate-500">Average time per project check</div>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold">
                      {latest.governanceSystem.meanLatencyMs.toFixed(2)} ms
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-600">
                      {latest.baselineSystem.meanLatencyMs.toFixed(2)} ms
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono">
                      +{latest.deltas.meanLatencyMs.toFixed(2)} ms
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-base font-bold text-[#0B2545] mb-3">
                Governance System vs Baseline Chart (n = 36)
              </h3>
              <svg
                viewBox="0 0 500 240"
                className="w-full h-auto"
                role="img"
                aria-label="Bar chart comparing Governance System and Baseline metrics"
              >
                <title>Benchmark comparison bar chart</title>
                <line x1={40} y1={190} x2={480} y2={190} stroke="#CBD5E1" strokeWidth="1" />
                {chartMetrics.map((m, i) => {
                  const groupX = 65 + i * 105;
                  const hGov = Math.max(4, m.gov * 150);
                  const hBase = Math.max(4, m.base * 150);
                  return (
                    <g key={m.label}>
                      <rect x={groupX} y={190 - hGov} width={28} height={hGov} rx={3} fill="#0B2545" />
                      <text x={groupX + 14} y={190 - hGov - 5} textAnchor="middle" className="text-[10px] font-mono fill-slate-800">
                        {(m.gov * 100).toFixed(0)}%
                      </text>
                      <rect x={groupX + 34} y={190 - hBase} width={28} height={hBase} rx={3} fill="#94A3B8" />
                      <text x={groupX + 48} y={190 - hBase - 5} textAnchor="middle" className="text-[10px] font-mono fill-slate-600">
                        {(m.base * 100).toFixed(0)}%
                      </text>
                      <text x={groupX + 31} y={210} textAnchor="middle" className="text-[11px] fill-slate-700 font-medium">
                        {m.label}
                      </text>
                    </g>
                  );
                })}
                <rect x={315} y={10} width={12} height={12} fill="#0B2545" rx={2} />
                <text x={332} y={20} className="text-[11px] fill-slate-700">Governance</text>
                <rect x={410} y={10} width={12} height={12} fill="#94A3B8" rx={2} />
                <text x={427} y={20} className="text-[11px] fill-slate-700">Baseline</text>
              </svg>
              <p className="text-sm text-slate-600 mt-2">
                Chart summary: The forward-chaining governance engine achieves {(latest.governanceSystem.gateF1 * 100).toFixed(1)}% gate F1 compared to {(latest.baselineSystem.gateF1 * 100).toFixed(1)}% for the regex baseline across all 36 cases.
              </p>
            </div>
          </div>

          {/* Per-Category Breakdown */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-base font-bold text-[#0B2545] mb-3">
              Per-Category Breakdown (12 Normal · 12 Edge · 12 Incomplete)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 tabular-nums">
              {(['normal', 'edge', 'incomplete'] as const).map((cat) => {
                const c = latest.perCategory[cat];
                return (
                  <div key={cat} className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1 text-sm">
                    <div className="font-bold text-[#0B2545] capitalize">
                      {cat} Cases (n = {c.count})
                    </div>
                    <div>Artefact F1: {(c.governanceF1 * 100).toFixed(1)}% vs {(c.baselineF1 * 100).toFixed(1)}%</div>
                    <div>Gate F1: {(c.governanceGateF1 * 100).toFixed(1)}% vs {(c.baselineGateF1 * 100).toFixed(1)}%</div>
                    <div>Citation Acc: {(c.governanceCitationAccuracy * 100).toFixed(1)}% vs {(c.baselineCitationAccuracy * 100).toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Failure Analysis & Trade-Offs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h3 className="text-base font-bold text-[#0B2545]">Failure Analysis</h3>
              {(
                [
                  ['False Positives', latest.failureAnalysis.falsePositives],
                  ['False Negatives', latest.failureAnalysis.falseNegatives],
                  ['Retrieval Failures', latest.failureAnalysis.retrievalFailures],
                  ['Cases Needing Two-Hop Retrieval', latest.failureAnalysis.twoHopCases],
                ] as const
              ).map(([title, list]) => (
                <div key={title} className="space-y-1">
                  <div className="text-sm font-semibold text-slate-800">{title}</div>
                  {list.length === 0 ? (
                    <p className="text-xs text-slate-500">None observed in this run.</p>
                  ) : (
                    <ul className="text-xs text-slate-700 space-y-1 list-disc pl-5">
                      {list.map((f) => (
                        <li key={f.caseId}>
                          <span className="font-mono font-semibold">{f.caseId}</span> ({f.category}): {f.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-sm text-slate-700">
              <h3 className="text-base font-bold text-[#0B2545]">Design Trade-Offs</h3>
              <p>
                <strong>Latency &amp; ontology maintenance vs compliance blind spots:</strong> The rule engine and hybrid IR take slightly more compute per check than regex keyword matching, and require maintaining the 6-stage ontology, but catch context-dependent violations (like expired ethics approvals or missing subgroup fairness on academic standing models) that static checklists miss.
              </p>
              <p>
                <strong>Strict gates vs flexibility:</strong> Blocking gates prevent high readiness scores from masking missing mandatory items, while scoped time-bound exceptions allow legitimate synthetic or wrapper workflows to reach human review without auto-approving release.
              </p>
              <p>
                <strong>Automation vs human oversight:</strong> Automated checks surface missing evidence and grounded policy clauses quickly, while final sign-off and formal risk acceptance remain strictly with independent human reviewers and the Risk Acceptance Authority.
              </p>
            </div>
          </div>

          {/* Run History */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-base font-bold text-[#0B2545] mb-3">Evaluation Run History</h3>
            <div className="divide-y divide-slate-200 text-sm tabular-nums">
              {runs.map((r) => (
                <div key={r.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-semibold text-[#0B2545]">{r.id}</span>{' '}
                    <span className="text-slate-500 text-xs">{r.created_at.slice(0, 19).replace('T', ' ')}</span>
                  </div>
                  <div className="text-xs font-mono text-slate-700">
                    Gate F1 {(r.summary.governanceSystem.gateF1 * 100).toFixed(1)}% · Citation {(r.summary.governanceSystem.citationGroundingAccuracy * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
