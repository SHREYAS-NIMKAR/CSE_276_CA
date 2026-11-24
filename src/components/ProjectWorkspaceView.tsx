import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Plus,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import { apiRequest, downloadAuthedFile } from '../api';
import {
  AssessmentResult,
  EvidenceItem,
  EvidenceStatus,
  ExceptionItem,
  FairnessCheck,
  KnowledgeGraphData,
  ProjectItem,
  ReviewCommentItem,
  RiskAcceptanceItem,
  SystemSettings,
  User,
} from '../types';
import { buildOverallSuggestion } from '../utils/overallSuggestion';
import { OverallSuggestionCard } from './OverallSuggestionCard';
import {
  DemoTag,
  HelpTooltip,
  mapStageWordToStatus,
  StatusIndicator,
} from './UiPrimitives';

type WorkspaceTab =
  | 'overview'
  | 'evidence'
  | 'risks'
  | 'trace'
  | 'review'
  | 'export';

interface ProjectDetailResponse {
  project: ProjectItem;
  evidence: EvidenceItem[];
  fairnessCheck: FairnessCheck | null;
  exceptions: ExceptionItem[];
  riskAcceptances: RiskAcceptanceItem[];
  comments: ReviewCommentItem[];
  latestAssessment: AssessmentResult;
}

export function ProjectWorkspaceView({
  projects,
  selectedProjectId,
  onSelectProject,
  knowledge,
  user,
  usersDirectory,
  settings,
  detailedMode,
  onProjectsChanged,
  onNavigateToPolicy,
}: {
  projects: ProjectItem[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  knowledge: KnowledgeGraphData;
  user: User;
  usersDirectory: User[];
  settings?: SystemSettings;
  detailedMode: boolean;
  onProjectsChanged: () => Promise<void>;
  onNavigateToPolicy: (clauseId?: string) => void;
}) {
  const [tab, setTab] = useState<WorkspaceTab>('overview');
  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [expandedClauses, setExpandedClauses] = useState<Record<string, boolean>>({});
  const [jsonLdPreview, setJsonLdPreview] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  // Evidence edit local buffers
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [linksDraft, setLinksDraft] = useState<Record<string, string>>({});
  const [expiryDraft, setExpiryDraft] = useState<Record<string, string>>({});
  const [missingnessDraft, setMissingnessDraft] = useState<Record<string, string>>({});

  // Fairness check state
  const [metricName, setMetricName] = useState('Accuracy');
  const [cohorts, setCohorts] = useState<Array<{ cohort: string; value: string }>>([
    { cohort: 'Domestic Students', value: '0.88' },
    { cohort: 'International Students', value: '0.85' },
  ]);

  // Exception request form
  const [exTargetType, setExTargetType] = useState<'artefact' | 'rule'>('artefact');
  const [exTargetId, setExTargetId] = useState('provenance_log');
  const [exRationale, setExRationale] = useState('');
  const [exExpiry, setExExpiry] = useState(
    new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10)
  );

  // Reviewer decision comment
  const [decisionComments, setDecisionComments] = useState<Record<string, string>>({});
  const [reviewComment, setReviewComment] = useState('');

  // Formal Risk Acceptance form (RAA only)
  const [raRiskId, setRaRiskId] = useState('');
  const [raRationale, setRaRationale] = useState('');
  const [raScope, setRaScope] = useState('');
  const [raExpiry, setRaExpiry] = useState(
    new Date(Date.now() + 90 * 86400 * 1000).toISOString().slice(0, 10)
  );

  // Create project form
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newReviewerId, setNewReviewerId] = useState('');
  const [newAutonomy, setNewAutonomy] = useState<'advisory' | 'automated_action'>('advisory');
  const [newSensitivity, setNewSensitivity] = useState<'low' | 'medium' | 'high'>('medium');
  const [newAcademic, setNewAcademic] = useState(false);
  const [newSynthetic, setNewSynthetic] = useState(false);
  const [newWrapper, setNewWrapper] = useState(false);
  const [newAdminScript, setNewAdminScript] = useState(false);
  const [newPopulation, setNewPopulation] = useState('Undergraduate students');

  async function loadDetail(id: string) {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<ProjectDetailResponse>(`/projects/${id}`);
      setDetail(data);

      const nMap: Record<string, string> = {};
      const lMap: Record<string, string> = {};
      const eMap: Record<string, string> = {};
      const mMap: Record<string, string> = {};
      for (const ev of data.evidence) {
        nMap[ev.artefact_id] = ev.notes || '';
        lMap[ev.artefact_id] = ev.external_link || '';
        eMap[ev.artefact_id] = ev.expiry_date ? ev.expiry_date.slice(0, 10) : '';
        mMap[ev.artefact_id] =
          ev.missingness_pct !== null && ev.missingness_pct !== undefined
            ? String((ev.missingness_pct * 100).toFixed(1))
            : '';
      }
      setNotesDraft(nMap);
      setLinksDraft(lMap);
      setExpiryDraft(eMap);
      setMissingnessDraft(mMap);

      if (data.fairnessCheck) {
        setMetricName(data.fairnessCheck.metric_name);
        setCohorts(
          data.fairnessCheck.cohorts.map((c) => ({
            cohort: c.cohort,
            value: String(c.value),
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load project details.');
    } finally {
      setLoading(false);
    }
  }

  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
    if (selectedProjectId) {
      loadDetail(selectedProjectId);
    } else {
      setDetail(null);
    }
  }, [selectedProjectId]);

  function flash(msg: string) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  }

  async function handleRunCheck() {
    if (!detail) return;
    setChecking(true);
    setError(null);
    try {
      await apiRequest(`/projects/${detail.project.id}/assess`, { method: 'POST' });
      await loadDetail(detail.project.id);
      await onProjectsChanged();
      flash('Check complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Readiness check failed.');
    } finally {
      setChecking(false);
    }
  }

  async function handleSaveEvidence(artefactId: string, nextStatus: EvidenceStatus) {
    if (!detail) return;
    setError(null);
    try {
      const payload: Record<string, unknown> = { status: nextStatus };
      if (user.role === 'PROJECT_OWNER' || user.role === 'ADMIN') {
        payload.notes = notesDraft[artefactId] ?? '';
        payload.external_link = linksDraft[artefactId] ?? '';
        payload.expiry_date = expiryDraft[artefactId]
          ? new Date(expiryDraft[artefactId]).toISOString()
          : null;
        if (artefactId === 'schema_profile' && missingnessDraft[artefactId] !== '') {
          payload.missingness_pct = Number(missingnessDraft[artefactId]) / 100;
        }
      }
      await apiRequest(`/projects/${detail.project.id}/evidence/${artefactId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await loadDetail(detail.project.id);
      await onProjectsChanged();
      flash('Saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save evidence.');
    }
  }

  async function handleUploadFile(artefactId: string, file: File) {
    if (!detail) return;
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await apiRequest(`/projects/${detail.project.id}/evidence/${artefactId}/upload`, {
        method: 'POST',
        body: form,
      });
      await loadDetail(detail.project.id);
      await onProjectsChanged();
      flash('File uploaded and checksum verified');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File upload failed.');
    }
  }

  async function handleSaveFairness(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setError(null);
    try {
      await apiRequest(`/projects/${detail.project.id}/fairness-check`, {
        method: 'PUT',
        body: JSON.stringify({
          metric_name: metricName,
          cohorts: cohorts.map((c) => ({ cohort: c.cohort, value: Number(c.value) })),
        }),
      });
      await loadDetail(detail.project.id);
      await onProjectsChanged();
      flash('Fairness parity check saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fairness check failed.');
    }
  }

  async function handleRequestException(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setError(null);
    try {
      await apiRequest(`/projects/${detail.project.id}/exceptions`, {
        method: 'POST',
        body: JSON.stringify({
          target_type: exTargetType,
          target_id: exTargetId,
          rationale: exRationale,
          expiry_date: new Date(exExpiry).toISOString(),
        }),
      });
      setExRationale('');
      await loadDetail(detail.project.id);
      await onProjectsChanged();
      flash('Exception request submitted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request exception.');
    }
  }

  async function handleDecideException(exId: string, decision: 'Approved' | 'Rejected') {
    if (!detail) return;
    setError(null);
    try {
      await apiRequest(`/exceptions/${exId}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          comment: decisionComments[exId] || `${decision} after governance review.`,
        }),
      });
      await loadDetail(detail.project.id);
      await onProjectsChanged();
      flash(`Exception ${decision.toLowerCase()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record decision.');
    }
  }

  async function handleWorkflowTransition(targetState: string) {
    if (!detail) return;
    setError(null);
    try {
      await apiRequest(`/projects/${detail.project.id}/workflow`, {
        method: 'POST',
        body: JSON.stringify({
          target_state: targetState,
          comment: reviewComment,
        }),
      });
      setReviewComment('');
      await loadDetail(detail.project.id);
      await onProjectsChanged();
      flash(`Workflow updated to "${targetState}"`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transition blocked.');
    }
  }

  async function handleFormalRiskAccept(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setError(null);
    try {
      await apiRequest(`/projects/${detail.project.id}/risk-acceptances`, {
        method: 'POST',
        body: JSON.stringify({
          risk_id: raRiskId,
          rationale: raRationale,
          scope: raScope,
          expiry_date: new Date(raExpiry).toISOString(),
        }),
      });
      setRaRationale('');
      setRaScope('');
      await loadDetail(detail.project.id);
      await onProjectsChanged();
      flash('Formal risk acceptance recorded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept risk.');
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !reviewComment.trim()) return;
    setError(null);
    try {
      await apiRequest(`/projects/${detail.project.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ comment: reviewComment }),
      });
      setReviewComment('');
      await loadDetail(detail.project.id);
      flash('Comment added');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment.');
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const reviewerId =
        newReviewerId ||
        eligibleReviewers[0]?.id ||
        '';
      const created = await apiRequest<{ id: string }>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: newName,
          description: newDesc,
          assigned_reviewer_id: reviewerId,
          deployment_autonomy: newAutonomy,
          affects_academic_standing: newAcademic,
          data_sensitivity: newSensitivity,
          uses_synthetic_data: newSynthetic,
          uses_third_party_wrapper: newWrapper,
          is_low_risk_admin_script: newAdminScript,
          target_user_population: newPopulation,
        }),
      });
      setShowCreateModal(false);
      setNewName('');
      setNewDesc('');
      await onProjectsChanged();
      onSelectProject(created.id);
      flash('Project created and assessed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create project.');
    }
  }

  async function handleDeleteProject() {
    if (!detail) return;
    setError(null);
    try {
      await apiRequest(`/projects/${detail.project.id}`, { method: 'DELETE' });
      setConfirmDelete(false);
      setDetail(null);
      await onProjectsChanged();
      flash('Project deleted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete project.');
    }
  }

  const dedicatedReviewers = usersDirectory.filter(
    (u) => u.role === 'REVIEWER' && u.is_active !== false && u.id !== user.id
  );
  const eligibleReviewers =
    dedicatedReviewers.length > 0
      ? dedicatedReviewers
      : usersDirectory.filter((u) => u.role === 'ADMIN' && u.is_active !== false);
  const usingInterimAdminReviewer = dedicatedReviewers.length === 0;
  const canCreateProject = user.role === 'PROJECT_OWNER' || user.role === 'ADMIN';
  const isOwner = detail ? detail.project.owner_id === user.id : false;
  const canEditEvidence =
    user.role === 'ADMIN' || (user.role === 'PROJECT_OWNER' && isOwner);
  const canVerifyEvidence =
    (user.role === 'REVIEWER' && !isOwner) || user.role === 'ADMIN';

  const assessment = detail?.latestAssessment ?? null;
  const evidenceByArt = new Map((detail?.evidence ?? []).map((e) => [e.artefact_id, e]));

  // Review step bar stages (Section 16G)
  const reviewSteps = [
    'Draft',
    'Checked',
    'Exception-based review eligible',
    'Waiting for reviewer',
    'Signed off',
    'Cleared for Controlled Release',
  ];
  const currentReviewStepIdx = (() => {
    if (!detail || !assessment) return 0;
    const ws = detail.project.workflow_state;
    if (ws === 'Cleared for Controlled Release') return 5;
    if (ws === 'Reviewer Sign-Off') return 4;
    if (ws === 'Exception-Based Review Eligible') return 2;
    if (ws === 'Automated Check Passed') return 3;
    if (assessment.firedRules.length > 0 || assessment.overallReadiness > 0) return 1;
    return 0;
  })();

  return (
    <div className="space-y-6">
      {/* Sticky/Top Project Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto min-w-0">
          <div className="w-full sm:w-auto min-w-0">
            <label htmlFor="ws-project-select" className="text-xs font-medium text-slate-500 block">
              Selected AI Project
            </label>
            <select
              id="ws-project-select"
              value={selectedProjectId}
              onChange={(e) => onSelectProject(e.target.value)}
              className="mt-0.5 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-base font-bold text-[#0B2545] w-full sm:w-auto max-w-full"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {detail && <DemoTag isDemo={detail.project.is_demo} />}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canCreateProject && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-300 bg-white text-sm font-medium text-[#0B2545] rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" /> New Project
            </button>
          )}
          {detail && (user.role === 'ADMIN' || isOwner) && !confirmDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="px-3 py-2 border border-rose-200 bg-white text-xs font-medium text-rose-700 rounded-lg hover:bg-rose-50 cursor-pointer whitespace-nowrap"
            >
              Delete Project
            </button>
          )}
          {detail && confirmDelete && (
            <div className="inline-flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">
              <span className="text-xs font-medium text-rose-900">Delete permanently?</span>
              <button
                type="button"
                onClick={handleDeleteProject}
                className="px-2.5 py-1 bg-rose-700 text-white text-xs font-medium rounded cursor-pointer"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 bg-white border border-slate-300 text-xs rounded cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleRunCheck}
            disabled={checking || !detail}
            className="px-5 py-2 bg-[#0B2545] text-white text-sm font-semibold rounded-lg hover:bg-[#133863] disabled:opacity-60 cursor-pointer whitespace-nowrap"
          >
            {checking ? 'Checking project...' : 'Check my project'}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm font-medium text-emerald-900"
        >
          {feedback}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-900"
        >
          {error}
        </div>
      )}

      {loading && !detail ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-slate-600">
          Loading project workspace...
        </div>
      ) : detail && assessment ? (
        <>
          {/* Result Panel (Section 16E) */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
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
                <p className="text-base text-slate-800 mt-1">{assessment.releaseStatusSentence}</p>
              </div>
              <div className="w-full sm:w-64">
                <div className="flex items-center justify-between text-xs font-medium text-slate-600 mb-1">
                  <span>Readiness: {assessment.readinessLabel}</span>
                  <span className="tabular-nums font-mono">
                    {(assessment.overallReadiness * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      assessment.releaseLocked ? 'bg-amber-500' : 'bg-[#13A3A3]'
                    }`}
                    style={{ width: `${Math.round(assessment.overallReadiness * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Score high but gate locked callout + release-locked reasons */}
            {assessment.stageSummaries.some((s) => s.scoreHighButGateLocked) && (
              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 font-medium">
                {detailedMode
                  ? 'Score high but gate locked: one or more stages meet the readiness threshold (Rs) while a blocking gate (Gs = 0) remains open.'
                  : 'Your score is good, but one required item is still missing, so release is locked.'}
              </div>
            )}

            <OverallSuggestionCard
              suggestion={buildOverallSuggestion({
                assessment,
                evidence: detail.evidence,
                fairnessCheck: detail.fairnessCheck,
                project: detail.project,
                settings,
              })}
              onNavigateTab={(nextTab) => {
                setTab(nextTab);
                tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />

            {assessment.releaseLockedReasons.length > 0 && (
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                <div className="text-sm font-bold text-[#0B2545] mb-1">
                  Why release is locked:
                </div>
                <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1">
                  {assessment.releaseLockedReasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Three columns side-by-side on desktop: What is missing | Why it matters | How to fix it */}
            {assessment.guidanceItems.length > 0 && (
              <div className="space-y-3">
                <div className="hidden lg:grid lg:grid-cols-3 gap-4 text-xs font-bold text-slate-500 uppercase tracking-wide px-1">
                  <div>What is missing</div>
                  <div>Why it matters</div>
                  <div>How to fix it (policy source)</div>
                </div>
                <div className="space-y-3">
                  {assessment.guidanceItems.map((item) => {
                    const topClause = item.clauses[0];
                    return (
                      <div
                        key={item.id}
                        className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 rounded-lg border border-slate-200 bg-slate-50/50"
                      >
                        <div>
                          <div className="text-xs font-semibold text-rose-700 mb-0.5">
                            {item.severity} priority · Stage {item.stage}
                            {detailedMode ? ` · ${item.ruleId}` : ''}
                          </div>
                          <div className="text-sm font-bold text-[#0B2545]">
                            {item.plainHeadline}
                          </div>
                        </div>
                        <div className="text-sm text-slate-700">{item.whyItMatters}</div>
                        <div className="text-sm text-slate-700 space-y-1.5">
                          <p>{item.howToFixFromPolicy}</p>
                          <div className="flex flex-wrap items-center gap-3 text-xs">
                            {topClause && (
                              <button
                                type="button"
                                onClick={() => onNavigateToPolicy(topClause.clauseId)}
                                className="font-semibold text-[#13A3A3] hover:underline cursor-pointer"
                              >
                                See the policy ({topClause.clauseId})
                              </button>
                            )}
                            {item.needsHumanInspection && (
                              <span className="text-amber-800 font-medium">
                                Not sure: sent to reviewer
                              </span>
                            )}
                          </div>
                          {detailedMode && topClause && (
                            <div className="text-xs font-mono text-slate-500">
                              Hybrid {topClause.hybridScore.toFixed(2)} (BM25 {topClause.bm25Score.toFixed(2)} / TF-IDF {topClause.tfidfScore.toFixed(2)}) · Terms: {topClause.matchedTerms.join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 6 Workspace Tabs */}
          <div ref={tabsRef} className="bg-white border border-slate-200 rounded-xl">
            <div
              role="tablist"
              aria-label="Project workspace sections"
              className="flex flex-wrap gap-1 border-b border-slate-200 px-4 pt-3"
            >
              {(
                [
                  ['overview', 'Overview'],
                  ['evidence', 'Evidence'],
                  ['risks', 'Risks and Guidance'],
                  ['trace', 'Rule Trace'],
                  ['review', 'Review and Exceptions'],
                  ['export', 'Report and Export'],
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
              {/* TAB 1: OVERVIEW */}
              {tab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <h2 className="text-lg font-bold text-[#0B2545]">{detail.project.name}</h2>
                      <p className="text-sm text-slate-700">{detail.project.description}</p>
                      <dl className="grid grid-cols-2 gap-3 pt-3 text-sm border-t border-slate-200">
                        <div>
                          <dt className="text-slate-500 text-xs">Project Owner</dt>
                          <dd className="font-medium text-slate-900">{detail.project.owner_name}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500 text-xs">Assigned Reviewer</dt>
                          <dd className="font-medium text-slate-900">{detail.project.reviewer_name}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500 text-xs">Deployment Autonomy</dt>
                          <dd className="font-medium text-slate-900">{detail.project.deployment_autonomy}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500 text-xs">Data Sensitivity</dt>
                          <dd className="font-medium text-slate-900 capitalize">{detail.project.data_sensitivity}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500 text-xs">Affects Academic Standing</dt>
                          <dd className="font-medium text-slate-900">{detail.project.affects_academic_standing ? 'Yes' : 'No'}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500 text-xs">Target Population</dt>
                          <dd className="font-medium text-slate-900">{detail.project.target_user_population}</dd>
                        </div>
                      </dl>
                    </div>

                    <div>
                      <h3 className="text-base font-bold text-[#0B2545] mb-3">
                        Six-Stage Progress Tracker
                      </h3>
                      <div className="space-y-2.5">
                        {assessment.stageSummaries.map((s) => (
                          <div
                            key={s.stage}
                            className="p-3 rounded-lg border border-slate-200 flex items-center justify-between gap-3"
                          >
                            <div>
                              <div className="text-sm font-semibold text-slate-900">
                                Stage {s.stage}: {s.name}
                              </div>
                              <div className="text-xs text-slate-500">{s.focus}</div>
                            </div>
                            <div className="text-right">
                              <StatusIndicator
                                status={mapStageWordToStatus(s.statusWord)}
                                label={s.statusWord}
                              />
                              <div className="text-xs font-mono text-slate-500 mt-0.5">
                                {(s.rs * 100).toFixed(0)}% {detailedMode ? `· Gs=${s.gs}` : ''}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: EVIDENCE & FAIRNESS CHECK */}
              {tab === 'evidence' && (
                <div className="space-y-8">
                  {/* Stage 3 Fairness Check Table */}
                  <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-bold text-[#0B2545]">
                          Stage 3 Subgroup Fairness Parity Check
                        </h3>
                        <p className="text-sm text-slate-700 mt-0.5">
                          Enter how well the model works for each group. We will check the groups are treated similarly.
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Note: This system checks submitted evidence and metric summaries; it does not execute or evaluate models directly.
                        </p>
                      </div>
                      {detail.fairnessCheck && (
                        <StatusIndicator
                          status={detail.fairnessCheck.passed ? 'done' : 'blocked'}
                          label={
                            detail.fairnessCheck.passed
                              ? `Pass (gap ${((detail.fairnessCheck.max_gap ?? 0) * 100).toFixed(1)}%)`
                              : `Fail (gap ${((detail.fairnessCheck.max_gap ?? 0) * 100).toFixed(1)}%)`
                          }
                        />
                      )}
                    </div>

                    <form onSubmit={handleSaveFairness} className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <label htmlFor="fc-metric" className="text-xs font-semibold text-slate-700">
                          Metric Name:
                        </label>
                        <input
                          id="fc-metric"
                          type="text"
                          value={metricName}
                          disabled={!canEditEvidence}
                          onChange={(e) => setMetricName(e.target.value)}
                          className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {cohorts.map((c, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-white p-2.5 rounded-lg border border-slate-200">
                            <input
                              type="text"
                              aria-label={`Cohort ${idx + 1} name`}
                              value={c.cohort}
                              disabled={!canEditEvidence}
                              onChange={(e) => {
                                const next = [...cohorts];
                                next[idx].cohort = e.target.value;
                                setCohorts(next);
                              }}
                              placeholder="Group name"
                              className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded text-sm"
                            />
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              max="1"
                              aria-label={`Cohort ${idx + 1} score`}
                              value={c.value}
                              disabled={!canEditEvidence}
                              onChange={(e) => {
                                const next = [...cohorts];
                                next[idx].value = e.target.value;
                                setCohorts(next);
                              }}
                              className="w-24 px-2.5 py-1.5 border border-slate-300 rounded text-sm font-mono tabular-nums"
                            />
                          </div>
                        ))}
                      </div>

                      {canEditEvidence && (
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setCohorts((prev) => [...prev, { cohort: `Group ${prev.length + 1}`, value: '0.85' }])
                            }
                            className="px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white rounded-lg hover:bg-slate-100 cursor-pointer"
                          >
                            + Add Group
                          </button>
                          <button
                            type="submit"
                            className="px-4 py-1.5 text-sm font-medium bg-[#0B2545] text-white rounded-lg hover:bg-[#133863] cursor-pointer"
                          >
                            Compute &amp; Save Fairness Check
                          </button>
                        </div>
                      )}
                    </form>
                  </div>

                  {/* All 6 Stages & 21 Artefacts */}
                  {knowledge.stages.map((st) => {
                    const stageArts = knowledge.artefacts.filter((a) => a.stage === st.stage);
                    return (
                      <div key={st.stage} className="space-y-3">
                        <div className="flex items-baseline justify-between border-b border-slate-200 pb-2">
                          <h3 className="text-base font-bold text-[#0B2545]">
                            Stage {st.stage}: {st.name}
                          </h3>
                          <span className="text-xs text-slate-500">{st.acceptanceCriteria}</span>
                        </div>
                        <div className="space-y-3">
                          {stageArts.map((art) => {
                            const ev = evidenceByArt.get(art.id);
                            const currentStatus = ev?.status ?? 'Not submitted';
                            return (
                              <div
                                key={art.id}
                                className="p-4 rounded-lg border border-slate-200 space-y-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <div className="text-sm font-bold text-slate-900">
                                      {art.name}{' '}
                                      {art.isBlocking && (
                                        <span className="text-xs font-semibold text-rose-700 ml-1">
                                          (Required Gate)
                                        </span>
                                      )}
                                      {detailedMode && (
                                        <span className="text-xs font-mono text-slate-500 ml-2">
                                          weight {(art.weight * 100).toFixed(0)}%
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-slate-600 mt-0.5">
                                      Why this matters: {art.whyItMatters}
                                    </p>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <label htmlFor={`status-${art.id}`} className="sr-only">
                                      Status for {art.name}
                                    </label>
                                    <select
                                      id={`status-${art.id}`}
                                      value={currentStatus}
                                      disabled={!canEditEvidence && !canVerifyEvidence}
                                      onChange={(e) =>
                                        handleSaveEvidence(art.id, e.target.value as EvidenceStatus)
                                      }
                                      className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm font-medium"
                                    >
                                      {canEditEvidence && (
                                        <>
                                          <option value="Not submitted">Not submitted</option>
                                          <option value="Submitted">Submitted</option>
                                          <option value="Unclear">Unclear</option>
                                        </>
                                      )}
                                      {canVerifyEvidence && (
                                        <>
                                          {!canEditEvidence && (
                                            <option value={currentStatus} disabled>
                                              {currentStatus}
                                            </option>
                                          )}
                                          <option value="Verified">Verified</option>
                                          <option value="Unclear">Unclear</option>
                                        </>
                                      )}
                                    </select>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <div className="md:col-span-2">
                                    <label htmlFor={`notes-${art.id}`} className="block text-xs text-slate-500 mb-1">
                                      Evidence Notes
                                    </label>
                                    <input
                                      id={`notes-${art.id}`}
                                      type="text"
                                      disabled={!canEditEvidence}
                                      value={notesDraft[art.id] ?? ''}
                                      onChange={(e) =>
                                        setNotesDraft((p) => ({ ...p, [art.id]: e.target.value }))
                                      }
                                      placeholder="Describe submitted evidence or findings..."
                                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                                    />
                                  </div>

                                  <div>
                                    <label htmlFor={`exp-${art.id}`} className="block text-xs text-slate-500 mb-1">
                                      Optional Expiry Date
                                    </label>
                                    <input
                                      id={`exp-${art.id}`}
                                      type="date"
                                      disabled={!canEditEvidence}
                                      value={expiryDraft[art.id] ?? ''}
                                      onChange={(e) =>
                                        setExpiryDraft((p) => ({ ...p, [art.id]: e.target.value }))
                                      }
                                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                                  <div>
                                    <label htmlFor={`link-${art.id}`} className="block text-xs text-slate-500 mb-1">
                                      Reference Link
                                    </label>
                                    <input
                                      id={`link-${art.id}`}
                                      type="url"
                                      disabled={!canEditEvidence}
                                      value={linksDraft[art.id] ?? ''}
                                      onChange={(e) =>
                                        setLinksDraft((p) => ({ ...p, [art.id]: e.target.value }))
                                      }
                                      placeholder="https://..."
                                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                                    />
                                  </div>

                                  {art.id === 'schema_profile' && (
                                    <div>
                                      <label htmlFor="schema-missingness" className="block text-xs text-slate-500 mb-1">
                                        Dataset Missingness (%)
                                      </label>
                                      <input
                                        id="schema-missingness"
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        max="100"
                                        disabled={!canEditEvidence}
                                        value={missingnessDraft[art.id] ?? ''}
                                        onChange={(e) =>
                                          setMissingnessDraft((p) => ({ ...p, [art.id]: e.target.value }))
                                        }
                                        placeholder="e.g. 2.5"
                                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-mono disabled:bg-slate-50"
                                      />
                                    </div>
                                  )}

                                  <div className="flex flex-wrap items-center gap-2">
                                    {canEditEvidence && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => handleSaveEvidence(art.id, currentStatus)}
                                          className="px-3 py-1.5 bg-[#0B2545] text-white text-xs font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
                                        >
                                          Save Details
                                        </button>
                                        <label className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 bg-white text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer">
                                          <Upload className="w-3.5 h-3.5" />
                                          Upload File
                                          <input
                                            type="file"
                                            className="sr-only"
                                            onChange={(e) => {
                                              const f = e.target.files?.[0];
                                              if (f) handleUploadFile(art.id, f);
                                            }}
                                          />
                                        </label>
                                      </>
                                    )}
                                    {ev?.file_name && (
                                      <span className="text-xs font-mono text-slate-600">
                                        File: {ev.file_name} (SHA-256: {ev.file_checksum?.slice(0, 8)}...)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* TAB 3: RISKS & GUIDANCE + FORMAL RISK ACCEPTANCE */}
              {tab === 'risks' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                  <div className="space-y-4">
                    <h3 className="text-base font-bold text-[#0B2545]">
                      Project Governance Risks
                    </h3>
                    {assessment.riskSummaries
                      .filter((r) => r.status !== 'Mitigated' || detailedMode)
                      .map((r) => (
                        <div key={r.riskId} className="p-4 rounded-lg border border-slate-200 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-slate-900">{r.name}</span>
                            <span className="text-xs font-semibold text-slate-700">
                              {r.severity} · {r.status}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600">{r.plainExplanation}</p>
                          <div className="text-xs text-slate-500">
                            {r.acceptableUnderPolicy
                              ? 'Eligible for formal Risk Acceptance Authority sign-off.'
                              : 'Not acceptable under policy — must be mitigated.'}
                            {detailedMode && ` · ${r.riskId} · Rules: ${r.triggeringRuleIds.join(', ') || 'None'}`}
                          </div>
                        </div>
                      ))}

                    {/* Formal Risk Acceptance visible ONLY to RISK_ACCEPTANCE_AUTHORITY */}
                    {user.role === 'RISK_ACCEPTANCE_AUTHORITY' && (
                      <form
                        onSubmit={handleFormalRiskAccept}
                        className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
                      >
                        <div className="flex items-center gap-2 text-[#0B2545] font-bold text-sm">
                          <ShieldAlert className="w-4 h-4" />
                          Formal Risk Acceptance (RAA Authority Only)
                        </div>
                        <p className="text-xs text-slate-600">
                          Only risks marked acceptable under policy may be formally accepted with an explicit scope and mandatory expiry date.
                        </p>
                        <div>
                          <label htmlFor="raa-risk" className="block text-xs font-medium text-slate-700 mb-1">
                            Acceptable Open Risk
                          </label>
                          <select
                            id="raa-risk"
                            required
                            value={raRiskId}
                            onChange={(e) => setRaRiskId(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
                          >
                            <option value="">Select risk...</option>
                            {assessment.riskSummaries
                              .filter((r) => r.acceptableUnderPolicy && r.status !== 'Mitigated' && r.status !== 'Formally Accepted')
                              .map((r) => (
                                <option key={r.riskId} value={r.riskId}>
                                  [{r.severity}] {r.name} ({r.riskId})
                                </option>
                              ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="raa-scope" className="block text-xs font-medium text-slate-700 mb-1">
                            Exact Scope Accepted
                          </label>
                          <input
                            id="raa-scope"
                            type="text"
                            required
                            value={raScope}
                            onChange={(e) => setRaScope(e.target.value)}
                            placeholder="e.g. Pilot cohort Fall 2026 under advisor oversight"
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label htmlFor="raa-rationale" className="block text-xs font-medium text-slate-700 mb-1">
                            Written Rationale
                          </label>
                          <textarea
                            id="raa-rationale"
                            required
                            rows={2}
                            value={raRationale}
                            onChange={(e) => setRaRationale(e.target.value)}
                            placeholder="Explain compensating controls and institutional justification..."
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label htmlFor="raa-expiry" className="block text-xs font-medium text-slate-700 mb-1">
                            Mandatory Review / Expiry Date
                          </label>
                          <input
                            id="raa-expiry"
                            type="date"
                            required
                            value={raExpiry}
                            onChange={(e) => setRaExpiry(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
                          />
                        </div>
                        <button
                          type="submit"
                          className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
                        >
                          Record Formal Risk Acceptance
                        </button>
                      </form>
                    )}
                  </div>

                  {/* Grounded Policy Guidance */}
                  <div className="space-y-4">
                    <h3 className="text-base font-bold text-[#0B2545]">
                      Policy-Grounded Guidance
                    </h3>
                    {assessment.guidanceItems.length === 0 ? (
                      <p className="text-sm text-slate-600">
                        No open gaps requiring policy guidance.
                      </p>
                    ) : (
                      assessment.guidanceItems.map((g) => (
                        <div key={g.id} className="p-4 rounded-lg border border-slate-200 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-[#0B2545]">{g.plainHeadline}</span>
                            <span className="text-xs font-medium text-slate-700">
                              {g.clauses[0]?.confidenceLabel ?? 'Not sure: a person should check'}
                            </span>
                          </div>
                          <p className="text-sm text-slate-700">{g.howToFixFromPolicy}</p>
                          {g.clauses.map((c) => {
                            const isExpanded = Boolean(expandedClauses[`${g.id}-${c.clauseId}`]);
                            return (
                              <div key={c.clauseId} className="pt-2 border-t border-slate-100 text-xs space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-800">
                                    {c.source} · Sec. {c.sectionNumber} ({c.clauseId})
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedClauses((prev) => ({
                                        ...prev,
                                        [`${g.id}-${c.clauseId}`]: !isExpanded,
                                      }))
                                    }
                                    className="text-[#13A3A3] font-medium hover:underline cursor-pointer"
                                  >
                                    {isExpanded ? 'Hide full policy' : 'See full policy'}
                                  </button>
                                </div>
                                {isExpanded && (
                                  <div className="p-2.5 rounded bg-slate-50 text-slate-700 space-y-1">
                                    <p>{c.text}</p>
                                    {c.relatedClauses.length > 0 && (
                                      <div className="pt-1 border-t border-slate-200">
                                        <strong>Related requirement:</strong>{' '}
                                        {c.relatedClauses
                                          .map((rc) => `${rc.clauseId} (${rc.title}): ${rc.text}`)
                                          .join(' | ')}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {detailedMode && (
                                  <div className="font-mono text-slate-500">
                                    Hybrid {c.hybridScore.toFixed(2)} · BM25 {c.bm25Score.toFixed(2)} · TF-IDF {c.tfidfScore.toFixed(2)} · Why this clause: {c.matchedTerms.join(', ')}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: RULE TRACE */}
              {tab === 'trace' && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-bold text-[#0B2545]">
                      Forward-Chaining Execution Trace
                    </h3>
                    <span className="text-xs font-mono text-slate-500">
                      Run {assessment.runId} · {assessment.firedRules.length} rules fired
                    </span>
                  </div>

                  {assessment.conflicts.length > 0 && (
                    <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm">
                      <strong className="text-amber-900">Detected Rule Conflicts:</strong>
                      <ul className="mt-1 space-y-1 text-amber-900">
                        {assessment.conflicts.map((c) => (
                          <li key={c.id}>
                            [{c.blockingRuleId} vs {c.exceptionRuleId} on {c.target}] {c.resolution}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                    {assessment.firedRules.map((fr) => (
                      <div key={fr.step} className="p-4 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-bold text-[#0B2545]">
                            Step {fr.step}: {fr.ruleName}
                          </span>
                          <span className="text-xs font-mono text-slate-600">
                            {fr.ruleId} · {fr.ruleType} · Priority {fr.priority}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700">{fr.plainExplanation}</p>
                        {detailedMode && (
                          <div className="text-xs font-mono text-slate-500 pt-1">
                            Matched: [{fr.matchedFacts.join(', ')}] → Derived: [{fr.derivedFacts.join(', ')}]
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 5: REVIEW & EXCEPTIONS */}
              {tab === 'review' && (
                <div className="space-y-6">
                  {/* Review Progress Bar (Section 16G) */}
                  <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                    <h3 className="text-base font-bold text-[#0B2545]">Review &amp; Clearance Progress</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                      {reviewSteps.map((stepLabel, idx) => {
                        const done = idx <= currentReviewStepIdx;
                        return (
                          <div
                            key={stepLabel}
                            className={`p-2.5 rounded-lg border text-xs font-medium ${
                              done
                                ? 'bg-[#0B2545] text-white border-[#0B2545]'
                                : 'bg-white text-slate-500 border-slate-200'
                            }`}
                          >
                            {idx + 1}. {stepLabel}
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-sm text-slate-700">
                      Current state: <strong>{detail.project.workflow_state}</strong>.{' '}
                      {detail.project.workflow_state === 'Cleared for Controlled Release'
                        ? 'This project has completed independent reviewer sign-off and is cleared for controlled release.'
                        : assessment.releaseLocked
                        ? `Project owner (${detail.project.owner_name}) must resolve open gates or submit evidence before reviewer sign-off.`
                        : `Assigned reviewer (${detail.project.reviewer_name}) can now record sign-off or clear for controlled release.`}
                    </p>

                    {/* Workflow Action Buttons (server-enforced) */}
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      {(user.role === 'REVIEWER' || user.role === 'ADMIN') &&
                        user.id !== detail.project.owner_id && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleWorkflowTransition('Reviewer Sign-Off')}
                              className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
                            >
                              Record Reviewer Sign-Off
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleWorkflowTransition('Cleared for Controlled Release')
                              }
                              className="px-4 py-2 bg-[#13A3A3] text-white text-sm font-medium rounded-lg hover:bg-teal-700 cursor-pointer"
                            >
                              Clear for Controlled Release
                            </button>
                          </>
                        )}
                      {detail.project.workflow_state !== 'Draft' && (
                        <button
                          type="button"
                          onClick={() => handleWorkflowTransition('Draft')}
                          className="px-3 py-2 border border-slate-300 bg-white text-sm font-medium rounded-lg hover:bg-slate-100 cursor-pointer"
                        >
                          Return to Draft
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                    {/* Exception Request Form */}
                    <div className="space-y-4">
                      <h3 className="text-base font-bold text-[#0B2545]">
                        Temporary Exceptions
                      </h3>
                      <p className="text-xs text-slate-600">
                        An exception is a temporary permission approved by a reviewer. It does not mean the project is ready for release.
                      </p>

                      {(user.role === 'PROJECT_OWNER' || user.role === 'ADMIN') && (
                        <form
                          onSubmit={handleRequestException}
                          className="p-4 rounded-lg border border-slate-200 space-y-3"
                        >
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label htmlFor="ex-type" className="block text-xs font-medium text-slate-700 mb-1">
                                Target Type
                              </label>
                              <select
                                id="ex-type"
                                value={exTargetType}
                                onChange={(e) => {
                                  const nextType = e.target.value as 'artefact' | 'rule';
                                  setExTargetType(nextType);
                                  setExTargetId(nextType === 'artefact' ? 'provenance_log' : 'R2');
                                }}
                                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                              >
                                <option value="artefact">Specific Artefact</option>
                                <option value="rule">Specific Rule</option>
                              </select>
                            </div>
                            <div>
                              <label htmlFor="ex-target" className="block text-xs font-medium text-slate-700 mb-1">
                                Target ID
                              </label>
                              {exTargetType === 'artefact' ? (
                                <select
                                  id="ex-target"
                                  value={exTargetId}
                                  onChange={(e) => setExTargetId(e.target.value)}
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                                >
                                  {knowledge.artefacts.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name} ({a.id})
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  id="ex-target"
                                  type="text"
                                  value={exTargetId}
                                  onChange={(e) => setExTargetId(e.target.value)}
                                  placeholder="e.g. R2"
                                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                                />
                              )}
                            </div>
                          </div>

                          <div>
                            <label htmlFor="ex-rationale" className="block text-xs font-medium text-slate-700 mb-1">
                              Written Rationale
                            </label>
                            <textarea
                              id="ex-rationale"
                              required
                              rows={2}
                              value={exRationale}
                              onChange={(e) => setExRationale(e.target.value)}
                              placeholder="Explain why a scoped temporary exception is justified..."
                              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                            />
                          </div>

                          <div>
                            <label htmlFor="ex-expiry" className="block text-xs font-medium text-slate-700 mb-1">
                              Expiry Date
                            </label>
                            <input
                              id="ex-expiry"
                              type="date"
                              required
                              value={exExpiry}
                              onChange={(e) => setExExpiry(e.target.value)}
                              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                            />
                          </div>

                          <button
                            type="submit"
                            className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
                          >
                            Request Scoped Exception
                          </button>
                        </form>
                      )}

                      <div className="space-y-3">
                        {detail.exceptions.length === 0 ? (
                          <p className="text-sm text-slate-500">No exception requests recorded.</p>
                        ) : (
                          detail.exceptions.map((ex) => {
                            const canDecide =
                              (user.role === 'REVIEWER' || user.role === 'ADMIN') &&
                              ex.status === 'Pending' &&
                              ex.requester_id !== user.id &&
                              detail.project.owner_id !== user.id;
                            return (
                              <div key={ex.id} className="p-4 rounded-lg border border-slate-200 space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="font-bold text-slate-900">
                                    {ex.target_type}: {ex.target_id}
                                  </span>
                                  <span className="text-xs font-semibold text-slate-700">
                                    {ex.status} · Expires {ex.expiry_date.slice(0, 10)}
                                  </span>
                                </div>
                                <p className="text-sm text-slate-700">{ex.rationale}</p>
                                <p className="text-xs text-slate-500">
                                  Requested by {ex.requester_name}
                                  {ex.reviewer_name ? ` · Reviewed by ${ex.reviewer_name}: ${ex.reviewer_comment}` : ''}
                                </p>
                                {canDecide && (
                                  <div className="pt-2 space-y-2 border-t border-slate-100">
                                    <input
                                      type="text"
                                      placeholder="Reviewer decision comment..."
                                      value={decisionComments[ex.id] ?? ''}
                                      onChange={(e) =>
                                        setDecisionComments((p) => ({ ...p, [ex.id]: e.target.value }))
                                      }
                                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
                                    />
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleDecideException(ex.id, 'Approved')}
                                        className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-medium rounded-lg hover:bg-emerald-800 cursor-pointer"
                                      >
                                        Approve Exception
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDecideException(ex.id, 'Rejected')}
                                        className="px-3 py-1.5 bg-rose-700 text-white text-xs font-medium rounded-lg hover:bg-rose-800 cursor-pointer"
                                      >
                                        Reject Exception
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Review History & Comments */}
                    <div className="space-y-4">
                      <h3 className="text-base font-bold text-[#0B2545]">Review History</h3>
                      <form onSubmit={handleAddComment} className="flex gap-2">
                        <input
                          type="text"
                          value={reviewComment}
                          onChange={(e) => setReviewComment(e.target.value)}
                          placeholder="Add a review note or comment..."
                          aria-label="Add review comment"
                          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                        <button
                          type="submit"
                          className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
                        >
                          Post
                        </button>
                      </form>

                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                        {detail.comments.length === 0 ? (
                          <div className="p-4 text-sm text-slate-500">No review comments yet.</div>
                        ) : (
                          detail.comments.map((c) => (
                            <div key={c.id} className="p-3.5 text-sm">
                              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                                <span className="font-semibold text-slate-800">
                                  {c.author_name} ({c.author_role})
                                </span>
                                <span>{c.created_at.slice(0, 16).replace('T', ' ')}</span>
                              </div>
                              <p className="text-slate-700">{c.comment}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 6: REPORT & EXPORT */}
              {tab === 'export' && (
                <div className="space-y-5">
                  <h3 className="text-base font-bold text-[#0B2545]">
                    Governance Reports &amp; Exports
                  </h3>
                  <p className="text-sm text-slate-600">
                    All exports reflect live server-computed readiness scores, rule traces, and approvals.
                    {detail.project.is_demo
                      ? ' Demonstration exports carry a DEMO label.'
                      : ''}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        downloadAuthedFile(
                          `/projects/${detail.project.id}/report.pdf`,
                          `governance-report-${detail.project.id}.pdf`
                        ).catch((e) => setError(e instanceof Error ? e.message : 'PDF download failed.'))
                      }
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
                    >
                      <FileText className="w-4 h-4" /> Download Governance PDF Report
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadAuthedFile(
                          `/projects/${detail.project.id}/export.csv`,
                          `project-${detail.project.id}.csv`
                        ).catch((e) => setError(e instanceof Error ? e.message : 'CSV export failed.'))
                      }
                      className="inline-flex items-center gap-2 px-4 py-2.5 border border-slate-300 bg-white text-sm font-medium text-slate-800 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      <Download className="w-4 h-4" /> Export Stage &amp; Evidence CSV
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const data = await apiRequest<Record<string, unknown>>(
                          `/projects/${detail.project.id}/jsonld`
                        );
                        setJsonLdPreview(JSON.stringify(data, null, 2));
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2.5 border border-slate-300 bg-white text-sm font-medium text-slate-800 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      View JSON-LD Export
                    </button>
                  </div>

                  {jsonLdPreview && (
                    <div className="space-y-2">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(jsonLdPreview)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded text-xs font-medium cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" /> Copy JSON-LD
                        </button>
                      </div>
                      <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg text-xs overflow-x-auto max-h-80">
                        {jsonLdPreview}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <h2 className="text-lg font-bold text-[#0B2545] mb-2">No AI Projects Registered</h2>
          <p className="text-sm text-slate-600 mb-5 max-w-md mx-auto">
            Register your first AI system to track lifecycle evidence, evaluate governance rules, and generate readiness reports.
          </p>
          {canCreateProject && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Register First AI Project
            </button>
          )}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-proj-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 id="new-proj-title" className="text-lg font-bold text-[#0B2545]">
              Register New AI Project
            </h2>
            <form onSubmit={handleCreateProject} className="space-y-3">
              <div>
                <label htmlFor="np-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Project Name
                </label>
                <input
                  id="np-name"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label htmlFor="np-desc" className="block text-xs font-medium text-slate-700 mb-1">
                  Description &amp; Intended Purpose
                </label>
                <textarea
                  id="np-desc"
                  required
                  rows={2}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="np-rev" className="block text-xs font-medium text-slate-700 mb-1">
                    Assigned Reviewer
                  </label>
                  <select
                    id="np-rev"
                    value={newReviewerId || eligibleReviewers[0]?.id || ''}
                    onChange={(e) => setNewReviewerId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    {eligibleReviewers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.full_name} {r.role !== 'REVIEWER' ? `(${r.role})` : ''}
                      </option>
                    ))}
                  </select>
                  {usingInterimAdminReviewer && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      Using Admin as interim reviewer until you register a dedicated Reviewer in Settings.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="np-pop" className="block text-xs font-medium text-slate-700 mb-1">
                    Target User Population
                  </label>
                  <input
                    id="np-pop"
                    required
                    value={newPopulation}
                    onChange={(e) => setNewPopulation(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="np-auto" className="block text-xs font-medium text-slate-700 mb-1">
                    Deployment Autonomy
                  </label>
                  <select
                    id="np-auto"
                    value={newAutonomy}
                    onChange={(e) =>
                      setNewAutonomy(e.target.value as 'advisory' | 'automated_action')
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="advisory">Advisory (human decides)</option>
                    <option value="automated_action">Automated Action</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="np-sens" className="block text-xs font-medium text-slate-700 mb-1">
                    Data Sensitivity
                  </label>
                  <select
                    id="np-sens"
                    value={newSensitivity}
                    onChange={(e) =>
                      setNewSensitivity(e.target.value as 'low' | 'medium' | 'high')
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2 pt-1 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newAcademic}
                    onChange={(e) => setNewAcademic(e.target.checked)}
                  />
                  Affects student academic standing
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newSynthetic}
                    onChange={(e) => setNewSynthetic(e.target.checked)}
                  />
                  Uses synthetic data
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newWrapper}
                    onChange={(e) => setNewWrapper(e.target.checked)}
                  />
                  Uses third-party foundation model wrapper without raw weights
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newAdminScript}
                    onChange={(e) => setNewAdminScript(e.target.checked)}
                  />
                  Low-risk internal administrative script
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm bg-[#0B2545] text-white font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
                >
                  Create &amp; Assess Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
