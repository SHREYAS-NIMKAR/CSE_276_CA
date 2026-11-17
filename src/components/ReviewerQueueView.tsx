import React, { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { apiRequest } from '../api';

interface QueueResponse {
  counts: {
    pendingExceptions: number;
    unclearArtefacts: number;
    lowConfidenceGuidance: number;
    ruleConflicts: number;
    total: number;
  };
  pendingExceptions: Array<{
    id: string;
    project_id: string;
    project_name: string;
    requester_name: string;
    target_type: string;
    target_id: string;
    rationale: string;
    expiry_date: string;
  }>;
  unclearEvidence: Array<{
    project_id: string;
    project_name: string;
    artefact_id: string;
    notes: string;
    updated_at: string;
  }>;
  lowConfidenceItems: Array<{
    project_id: string;
    project_name: string;
    ruleId: string;
    headline: string;
    score: number;
  }>;
  conflicts: Array<{
    project_id: string;
    project_name: string;
    conflictId: string;
    resolution: string;
  }>;
}

export function ReviewerQueueView({
  detailedMode,
  onOpenProject,
}: {
  detailedMode: boolean;
  onOpenProject: (projectId: string) => void;
}) {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadQueue() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<QueueResponse>('/reviewer-queue');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load reviewer queue.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#0B2545]">Human Reviewer Queue</h1>
          <p className="text-sm text-slate-600 mt-1">
            Items requiring human judgement: pending exception requests, unclear evidence, low-confidence policy matches, and resolved rule conflicts.
          </p>
        </div>
        <button
          type="button"
          onClick={loadQueue}
          className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 bg-white text-sm font-medium text-[#0B2545] rounded-lg hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" /> Refresh Queue
        </button>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-900">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-slate-600">
          Loading reviewer queue...
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-sm text-slate-500">Pending Exceptions</div>
              <div className="text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">
                {data.counts.pendingExceptions}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-sm text-slate-500">Unclear Artefacts</div>
              <div className="text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">
                {data.counts.unclearArtefacts}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-sm text-slate-500">Low-Confidence Guidance</div>
              <div className="text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">
                {data.counts.lowConfidenceGuidance}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-sm text-slate-500">Rule Conflicts</div>
              <div className="text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">
                {data.counts.ruleConflicts}
              </div>
            </div>
          </div>

          {/* Pending Exceptions */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="text-base font-bold text-[#0B2545]">Pending Exception Requests</h2>
            {data.pendingExceptions.length === 0 ? (
              <p className="text-sm text-slate-500">No pending exceptions awaiting review.</p>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {data.pendingExceptions.map((ex) => (
                  <div key={ex.id} className="p-4 flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-slate-900">
                        {ex.project_name} · {ex.target_type}: {ex.target_id}
                      </div>
                      <p className="text-sm text-slate-700">{ex.rationale}</p>
                      <div className="text-xs text-slate-500">
                        Requested by {ex.requester_name} · Expires {ex.expiry_date.slice(0, 10)}
                        {detailedMode ? ` · ${ex.id}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenProject(ex.project_id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0B2545] text-white text-xs font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
                    >
                      Review Project <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Unclear Evidence */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="text-base font-bold text-[#0B2545]">Unclear Evidence Items</h2>
            {data.unclearEvidence.length === 0 ? (
              <p className="text-sm text-slate-500">No artefacts marked Unclear across projects.</p>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {data.unclearEvidence.map((item, idx) => (
                  <div key={`${item.project_id}-${item.artefact_id}-${idx}`} className="p-4 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {item.project_name} · {item.artefact_id}
                      </div>
                      <p className="text-sm text-slate-600 mt-0.5">
                        {item.notes || 'Marked unclear for human clarification.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenProject(item.project_id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white text-xs font-medium text-[#0B2545] rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      Inspect Evidence <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Low-Confidence Policy Matches */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="text-base font-bold text-[#0B2545]">Low-Confidence Policy Guidance</h2>
            {data.lowConfidenceItems.length === 0 ? (
              <p className="text-sm text-slate-500">No low-confidence policy matches waiting in the queue.</p>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {data.lowConfidenceItems.map((lc, idx) => (
                  <div key={`${lc.project_id}-${lc.ruleId}-${idx}`} className="p-4 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {lc.project_name} · {lc.headline}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        We are not sure about the best policy match — a reviewer should inspect this guidance.
                        {detailedMode ? ` · Rule ${lc.ruleId} · Score ${lc.score.toFixed(2)}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenProject(lc.project_id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white text-xs font-medium text-[#0B2545] rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      Open Project <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rule Conflicts */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="text-base font-bold text-[#0B2545]">Rule Conflicts Flagged</h2>
            {data.conflicts.length === 0 ? (
              <p className="text-sm text-slate-500">No active rule conflicts across projects.</p>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                {data.conflicts.map((c, idx) => (
                  <div key={`${c.project_id}-${c.conflictId}-${idx}`} className="p-4 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {c.project_name} {detailedMode ? `· ${c.conflictId}` : ''}
                      </div>
                      <p className="text-sm text-slate-700 mt-0.5">{c.resolution}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenProject(c.project_id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 bg-white text-xs font-medium text-[#0B2545] rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      Inspect Trace <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
