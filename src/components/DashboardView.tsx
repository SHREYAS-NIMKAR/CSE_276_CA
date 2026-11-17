import React, { useState } from 'react';
import {
  AssessmentResult,
  ProjectItem,
  SystemSettings,
  User,
} from '../types';
import {
  DemoTag,
  HelpTooltip,
  mapStageWordToStatus,
  RiskDistributionChart,
  StageReadinessChart,
  StatusIndicator,
} from './UiPrimitives';

type DashTab = 'lifecycle' | 'evidence' | 'guidance' | 'exceptions';

export function DashboardView({
  projects,
  selectedProjectId,
  onSelectProject,
  assessment,
  settings,
  detailedMode,
  reviewerQueueCount,
  user,
  onOpenProjectWorkspace,
  onOpenProjects,
  onOpenReviewerQueue,
  onRunCheck,
  checking,
}: {
  projects: ProjectItem[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  assessment: AssessmentResult | null;
  settings: SystemSettings;
  detailedMode: boolean;
  reviewerQueueCount: number;
  user: User;
  onOpenProjectWorkspace: (id: string) => void;
  onOpenProjects?: () => void;
  onOpenReviewerQueue?: () => void;
  onRunCheck: () => void;
  checking: boolean;
}) {
  const [tab, setTab] = useState<DashTab>('lifecycle');
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

  if (!selectedProject || !assessment) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <h1 className="text-xl font-bold text-[#0B2545] mb-2">No AI Projects Yet</h1>
        <p className="text-slate-600 mb-5 max-w-lg mx-auto">
          Your workspace is ready for real projects. Register your first AI project to begin lifecycle evidence tracking, risk checks, and readiness reporting.
        </p>
        {onOpenProjects && (
          <button
            type="button"
            onClick={onOpenProjects}
            className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
          >
            Go to Projects &amp; Register First AI Project
          </button>
        )}
      </div>
    );
  }

  const bannerTone = assessment.releaseLocked
    ? assessment.highRiskOpenCount > 0
      ? 'bg-rose-50 border-rose-200 text-rose-900'
      : 'bg-amber-50 border-amber-200 text-amber-900'
    : assessment.releaseStatusBanner.includes('NEEDS REVIEW')
    ? 'bg-amber-50 border-amber-200 text-amber-900'
    : 'bg-emerald-50 border-emerald-200 text-emerald-900';

  return (
    <div className="space-y-6">
      {/* Top selector & primary check CTA */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto min-w-0">
          <label htmlFor="dash-project-select" className="text-sm font-semibold text-[#0B2545]">
            Project:
          </label>
          <select
            id="dash-project-select"
            value={selectedProject.id}
            onChange={(e) => onSelectProject(e.target.value)}
            className="px-3.5 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-900 w-full sm:w-auto max-w-full min-w-0"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.is_demo ? '(DEMO)' : ''}
              </option>
            ))}
          </select>
          <DemoTag isDemo={selectedProject.is_demo} />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onOpenProjectWorkspace(selectedProject.id)}
            className="px-4 py-2 border border-slate-300 bg-white text-sm font-medium text-[#0B2545] rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            Open Project Workspace
          </button>
          <button
            type="button"
            onClick={onRunCheck}
            disabled={checking}
            className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] disabled:opacity-60 cursor-pointer whitespace-nowrap"
          >
            {checking ? 'Checking...' : 'Check my project'}
          </button>
        </div>
      </div>

      {/* Release Status Banner */}
      <div className={`border rounded-xl p-5 ${bannerTone}`} role="status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <StatusIndicator
                status={
                  assessment.releaseLocked
                    ? 'blocked'
                    : assessment.releaseStatusBanner.includes('NEEDS REVIEW')
                    ? 'attention'
                    : 'done'
                }
                label={assessment.releaseStatusBanner}
              />
              {detailedMode && (
                <span className="font-mono text-xs text-slate-600">
                  Run {assessment.runId} · State: {selectedProject.workflow_state}
                </span>
              )}
            </div>
            <p className="text-base mt-1.5 font-medium">{assessment.releaseStatusSentence}</p>
          </div>
          <div className="text-right tabular-nums">
            <div className="text-xs uppercase tracking-wide opacity-80">Workflow State</div>
            <div className="text-sm font-bold">{selectedProject.workflow_state}</div>
          </div>
        </div>
      </div>

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-sm text-slate-500 flex items-center">
            Overall Readiness
            <HelpTooltip
              term="Overall Readiness"
              text="Average readiness score (Rs) across all 6 lifecycle stages. Even a high score cannot unlock release if any required gate is missing."
            />
          </div>
          <div className="text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">
            {(assessment.overallReadiness * 100).toFixed(0)}%
          </div>
          <div className="text-xs text-slate-600 mt-1">{assessment.readinessLabel}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-sm text-slate-500">Stages Complete</div>
          <div className="text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">
            {assessment.stagesCompleteCount} / 6
          </div>
          <div className="text-xs text-slate-600 mt-1">
            {assessment.releaseLocked ? 'Release locked' : 'All effective gates pass'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-sm text-slate-500">Open Risks</div>
          <div className="text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">
            {assessment.openRiskCount}
          </div>
          <div className="text-xs text-slate-600 mt-1">
            {assessment.highRiskOpenCount} high-severity open
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-sm text-slate-500">Waiting for Review</div>
          <div className="text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">
            {user.role === 'PROJECT_OWNER'
              ? assessment.guidanceItems.filter((g) => g.needsHumanInspection).length
              : reviewerQueueCount}
          </div>
          <div className="text-xs text-slate-600 mt-1 flex items-center justify-between gap-2">
            <span>
              {user.role === 'PROJECT_OWNER'
                ? 'Low-confidence items on this project'
                : 'Total reviewer queue items'}
            </span>
            {onOpenReviewerQueue && (
              <button
                type="button"
                onClick={onOpenReviewerQueue}
                className="font-semibold text-[#13A3A3] hover:underline cursor-pointer shrink-0"
              >
                Open Queue
              </button>
            )}
          </div>
        </div>
      </div>

      {/* What should I do next? Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-lg font-bold text-[#0B2545] mb-3">What should I do next?</h2>
        {assessment.nextActions.length === 0 ? (
          <p className="text-sm text-slate-600">
            No blocking actions remain for this project.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {assessment.nextActions.map((act) => (
              <div key={act.priority} className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-xs font-semibold text-[#13A3A3] mb-1">
                  Action {act.priority} · Stage {act.stage}
                  {detailedMode ? ` · ${act.ruleId}` : ''}
                </div>
                <div className="text-sm font-bold text-[#0B2545]">{act.title}</div>
                <p className="text-sm text-slate-600 mt-1">{act.detail}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4 Dashboard Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl">
        <div
          role="tablist"
          aria-label="Dashboard details"
          className="flex flex-wrap gap-1 border-b border-slate-200 px-4 pt-3"
        >
          {(
            [
              ['lifecycle', 'Lifecycle State'],
              ['evidence', 'Evidence and Risks'],
              ['guidance', 'Guidance and Confidence'],
              ['exceptions', 'Exceptions and Review'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                tab === key
                  ? 'border-[#0B2545] text-[#0B2545]'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === 'lifecycle' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              <div className="space-y-3">
                <h3 className="text-base font-bold text-[#0B2545]">
                  Six-Stage Readiness &amp; Gates
                </h3>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {assessment.stageSummaries.map((st) => (
                    <div key={st.stage} className="p-3.5 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          Stage {st.stage}: {st.name}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {st.verifiedCount}/{st.totalCount} verified
                          {detailedMode && ` · Rs=${st.rs.toFixed(2)} · Gs=${st.gs} · Effective=${st.effectiveGs}`}
                        </div>
                        {st.scoreHighButGateLocked && (
                          <div className="text-xs font-medium text-amber-800 mt-1">
                            {detailedMode
                              ? 'Score high but gate locked (Rs ≥ threshold, Gs = 0)'
                              : 'Your score is good, but one required item is still missing, so release is locked.'}
                          </div>
                        )}
                      </div>
                      <StatusIndicator status={mapStageWordToStatus(st.statusWord)} label={st.statusWord} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-base font-bold text-[#0B2545] mb-3">
                  Stage Readiness Chart
                </h3>
                <StageReadinessChart
                  stages={assessment.stageSummaries}
                  threshold={settings.readiness_threshold}
                />
              </div>
            </div>
          )}

          {tab === 'evidence' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              <div>
                <h3 className="text-base font-bold text-[#0B2545] mb-3">
                  Open &amp; Active Governance Risks
                </h3>
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg max-h-96 overflow-y-auto">
                  {assessment.riskSummaries
                    .filter((r) => r.status !== 'Mitigated' || detailedMode)
                    .map((r) => (
                      <div key={r.riskId} className="p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">{r.name}</span>
                          <span className="text-xs font-medium text-slate-700">
                            {r.severity} · {r.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-1">{r.plainExplanation}</p>
                        {detailedMode && (
                          <div className="text-xs font-mono text-slate-500 mt-1">
                            {r.riskId} · Rules: {r.triggeringRuleIds.join(', ') || 'None'} ·{' '}
                            {r.acceptableUnderPolicy ? 'Acceptable under policy' : 'Not acceptable'}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              <div>
                <h3 className="text-base font-bold text-[#0B2545] mb-3">
                  Risk Distribution
                </h3>
                <RiskDistributionChart risks={assessment.riskSummaries} />
              </div>
            </div>
          )}

          {tab === 'guidance' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-[#0B2545] mb-2">
                  1. Deterministic Rule Verdicts (No Similarity Scoring)
                </h3>
                {assessment.firedRules.length === 0 ? (
                  <p className="text-sm text-slate-600">No rule violations triggered.</p>
                ) : (
                  <ul className="space-y-2">
                    {assessment.firedRules.map((fr) => (
                      <li key={fr.ruleId} className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm">
                        <span className="font-semibold text-[#0B2545]">
                          {detailedMode ? `[${fr.ruleId} · ${fr.ruleType}] ` : ''}
                          {fr.ruleName}:
                        </span>{' '}
                        {fr.plainExplanation}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="text-base font-bold text-[#0B2545] mb-2">
                  2. Policy-Grounded Guidance (Retrieved Clauses &amp; Match Confidence)
                </h3>
                {assessment.guidanceItems.length === 0 ? (
                  <p className="text-sm text-slate-600">
                    No remediation guidance needed — all rule checks passed.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {assessment.guidanceItems.map((g) => (
                      <div key={g.id} className="p-4 rounded-lg border border-slate-200">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-bold text-[#0B2545]">{g.plainHeadline}</span>
                          <span className="text-xs font-medium text-slate-700">
                            {g.clauses[0]?.confidenceLabel ?? 'Not sure: a person should check'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 mt-1.5">{g.howToFixFromPolicy}</p>
                        {g.needsHumanInspection && (
                          <p className="text-xs text-amber-800 mt-1 font-medium">
                            We are not sure about this one, so it has been sent to a reviewer.
                          </p>
                        )}
                        {detailedMode && g.clauses[0] && (
                          <div className="text-xs font-mono text-slate-500 mt-2">
                            Rule {g.ruleId} · Clause {g.clauses[0].clauseId} · Hybrid {g.clauses[0].hybridScore.toFixed(2)} (BM25 {g.clauses[0].bm25Score.toFixed(2)}, TF-IDF {g.clauses[0].tfidfScore.toFixed(2)}) · Terms: {g.clauses[0].matchedTerms.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'exceptions' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-[#0B2545]">
                    Exceptions, Conflicts &amp; Release Locks
                  </h3>
                  <p className="text-sm text-slate-600">
                    Current workflow state: <strong>{selectedProject.workflow_state}</strong>.
                    {assessment.reliesOnException
                      ? ' This project currently relies on a temporary approved exception (permits review, never release).'
                      : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenProjectWorkspace(selectedProject.id)}
                  className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
                >
                  Manage Review &amp; Exceptions
                </button>
              </div>

              {assessment.conflicts.length > 0 && (
                <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm">
                  <strong className="text-amber-900">Rule Conflicts Resolved:</strong>
                  <ul className="mt-1 space-y-1 text-amber-900">
                    {assessment.conflicts.map((c) => (
                      <li key={c.id}>{c.resolution}</li>
                    ))}
                  </ul>
                </div>
              )}

              {assessment.releaseLockedReasons.length > 0 && (
                <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm">
                  <strong className="text-[#0B2545]">Release Lock Reasons:</strong>
                  <ul className="list-disc pl-5 mt-1 space-y-1 text-slate-700">
                    {assessment.releaseLockedReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
