import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  ClipboardCheck,
  FileCheck2,
  GitBranch,
  HelpCircle,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Scale,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { apiRequest, setCsrfToken, setOnUnauthorized, setSessionToken } from './api';
import { AuditLogView } from './components/AuditLogView';
import { DashboardView } from './components/DashboardView';
import { EvaluationView } from './components/EvaluationView';
import { HelpGlossaryView } from './components/HelpGlossaryView';
import { KnowledgeGraphView } from './components/KnowledgeGraphSvg';
import { ForcePasswordChangeView, LoginView } from './components/LoginView';
import { PolicyLibraryView } from './components/PolicyLibraryView';
import { ProjectWorkspaceView } from './components/ProjectWorkspaceView';
import { ReviewerQueueView } from './components/ReviewerQueueView';
import { RulesView } from './components/RulesView';
import { SettingsAdminView } from './components/SettingsAdminView';
import { SiteActivityView } from './components/SiteActivityView';
import { WelcomeTourModal } from './components/WelcomeTourModal';
import {
  KnowledgeGraphData,
  PolicyClauseItem,
  ProjectItem,
  RuleItem,
  SystemSettings,
  User,
} from './types';

type NavPage =
  | 'dashboard'
  | 'projects'
  | 'queue'
  | 'lifecycle'
  | 'rules'
  | 'policies'
  | 'evaluation'
  | 'audit'
  | 'activity'
  | 'settings'
  | 'selftests'
  | 'help';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [needsInitialSetup, setNeedsInitialSetup] = useState(false);
  const [sessionExpiredMsg, setSessionExpiredMsg] = useState<string | null>(null);
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [nextPw, setNextPw] = useState('');
  const [confirmNextPw, setConfirmNextPw] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState<string | null>(null);

  const [page, setPage] = useState<NavPage>('dashboard');
  const [detailedMode, setDetailedMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [knowledge, setKnowledge] = useState<KnowledgeGraphData | null>(null);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [clauses, setClauses] = useState<PolicyClauseItem[]>([]);
  const [settings, setSettings] = useState<SystemSettings>({
    missingness_threshold: 0.05,
    parity_tolerance: 0.05,
    readiness_threshold: 0.75,
    retrieval_high_threshold: 0.55,
    retrieval_medium_threshold: 0.25,
    hybrid_weight: 0.55,
    bm25_k1: 1.5,
    bm25_b: 0.75,
  });
  const [usersDirectory, setUsersDirectory] = useState<User[]>([]);
  const [reviewerQueueCount, setReviewerQueueCount] = useState(0);
  const [pendingAccessCount, setPendingAccessCount] = useState(0);
  const [highlightClauseId, setHighlightClauseId] = useState<string | null>(null);
  const [checkingDash, setCheckingDash] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const handleUnauthorized = useCallback(() => {
    setUser(null);
    setProjects([]);
    setCsrfToken('');
    setSessionToken('');
    setSessionExpiredMsg('Your session expired or was signed out. Please sign in again.');
  }, []);

  useEffect(() => {
    setOnUnauthorized(handleUnauthorized);
  }, [handleUnauthorized]);

  const loadAppData = useCallback(async (currentUser: User) => {
    setGlobalError(null);
    try {
      const [projRes, kgRes, ruleRes, polRes, setRes, dirRes] = await Promise.all([
        apiRequest<{ projects: ProjectItem[] }>('/projects'),
        apiRequest<KnowledgeGraphData>('/knowledge/graph'),
        apiRequest<{ rules: RuleItem[] }>('/rules'),
        apiRequest<{ clauses: PolicyClauseItem[] }>('/policies'),
        apiRequest<{ settings: SystemSettings }>('/settings'),
        apiRequest<{ users: User[] }>('/users'),
      ]);

      setProjects(projRes.projects);
      setSelectedProjectId((prev) =>
        prev && projRes.projects.some((p) => p.id === prev)
          ? prev
          : projRes.projects[0]?.id ?? ''
      );
      setKnowledge(kgRes);
      setRules(ruleRes.rules);
      setClauses(polRes.clauses);
      setSettings(setRes.settings);
      setUsersDirectory(dirRes.users);

      if (currentUser.role !== 'PROJECT_OWNER') {
        const qRes = await apiRequest<{ counts: { total: number } }>('/reviewer-queue');
        setReviewerQueueCount(qRes.counts.total);
      } else {
        setReviewerQueueCount(0);
      }

      if (currentUser.role === 'ADMIN') {
        const actRes = await apiRequest<{ stats: { pendingAccessRequests: number } }>('/admin/activity');
        setPendingAccessCount(actRes.stats.pendingAccessRequests);
      } else {
        setPendingAccessCount(0);
      }
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Unable to load governance data from server.'
      );
    }
  }, []);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem('ai_gov_visit_logged')) {
        sessionStorage.setItem('ai_gov_visit_logged', '1');
        apiRequest('/visits', {
          method: 'POST',
          body: JSON.stringify({
            path: window.location.pathname || '/',
            referrer: document.referrer || null,
          }),
        }).catch(() => {});
      }
    } catch {
      // ignore if sessionStorage blocked
    }
    (async () => {
      try {
        const [meResult, setupResult] = await Promise.allSettled([
          apiRequest<{ user: User; csrfToken: string; sessionToken?: string }>('/auth/me'),
          apiRequest<{ needsInitialSetup: boolean }>('/auth/setup-status'),
        ]);
        if (setupResult.status === 'fulfilled') {
          setNeedsInitialSetup(Boolean(setupResult.value.needsInitialSetup));
        }
        if (meResult.status === 'fulfilled') {
          const me = meResult.value;
          setCsrfToken(me.csrfToken);
          if (me.sessionToken) setSessionToken(me.sessionToken);
          setUser(me.user);
          await loadAppData(me.user);
        } else {
          setSessionToken('');
          setUser(null);
        }
      } finally {
        setAuthLoading(false);
      }
    })();
  }, [loadAppData]);

  async function handleLoginSuccess(loggedUser: User, csrfToken: string, sessionToken?: string) {
    setCsrfToken(csrfToken);
    setSessionToken(sessionToken || '');
    setSessionExpiredMsg(null);
    setNeedsInitialSetup(false);
    setUser(loggedUser);
    await loadAppData(loggedUser);

    const params = new URLSearchParams(window.location.search);
    if (
      params.get('autostart') !== '1' &&
      params.get('notour') !== '1' &&
      !sessionStorage.getItem('tour_seen')
    ) {
      setTourOpen(true);
      sessionStorage.setItem('tour_seen', '1');
    }
  }

  async function handleLogout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setCsrfToken('');
    setSessionToken('');
    setUser(null);
    setProjects([]);
  }

  async function refreshProjects() {
    if (!user) return;
    const projRes = await apiRequest<{ projects: ProjectItem[] }>('/projects');
    setProjects(projRes.projects);
    if (user.role !== 'PROJECT_OWNER') {
      const qRes = await apiRequest<{ counts: { total: number } }>('/reviewer-queue');
      setReviewerQueueCount(qRes.counts.total);
    }
  }

  async function handleDashboardRunCheck() {
    if (!selectedProjectId) return;
    setCheckingDash(true);
    try {
      await apiRequest(`/projects/${selectedProjectId}/assess`, { method: 'POST' });
      await refreshProjects();
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Readiness check failed.');
    } finally {
      setCheckingDash(false);
    }
  }

  async function handleLoadSampleProjects(key: 'ready' | 'needs_fixes' | 'exception' | 'all' = 'all') {
    const res = await apiRequest<{ createdCount: number; primaryProjectId: string }>(
      '/projects/load-samples',
      {
        method: 'POST',
        body: JSON.stringify({ key }),
      }
    );
    await refreshProjects();
    if (res.primaryProjectId) {
      setSelectedProjectId(res.primaryProjectId);
    }
    setPage('projects');
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-600">
        Loading AI Governance Assistant...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        onLoginSuccess={handleLoginSuccess}
        expiredBanner={sessionExpiredMsg}
        needsInitialSetup={needsInitialSetup}
      />
    );
  }

  if (user.force_password_change) {
    return (
      <ForcePasswordChangeView
        user={user}
        onCompleted={async () => {
          const me = await apiRequest<{ user: User; csrfToken: string }>('/auth/me');
          setCsrfToken(me.csrfToken);
          setUser(me.user);
        }}
      />
    );
  }

  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

  const navItems: Array<{
    id: NavPage;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    disabled?: boolean;
    disabledReason?: string;
    badge?: number;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'projects', label: 'Projects', icon: FileCheck2 },
    ...(user.role !== 'PROJECT_OWNER'
      ? [
          {
            id: 'queue' as NavPage,
            label: reviewerQueueCount > 0 ? `Reviewer Queue (${reviewerQueueCount})` : 'Reviewer Queue',
            icon: ClipboardCheck,
          },
        ]
      : []),
    { id: 'lifecycle', label: 'Lifecycle Model', icon: GitBranch },
    { id: 'rules', label: 'Rules', icon: Scale },
    { id: 'policies', label: 'Policy Library', icon: BookOpen },
    {
      id: 'evaluation',
      label: 'Evaluation',
      icon: Activity,
    },
    { id: 'audit', label: 'Audit Log', icon: ScrollText },
    ...(user.role === 'ADMIN'
      ? [
          {
            id: 'activity' as NavPage,
            label:
              pendingAccessCount > 0
                ? `Site Activity (${pendingAccessCount})`
                : 'Site Activity',
            icon: Users,
          },
        ]
      : []),
    {
      id: 'settings',
      label: 'Settings',
      icon: SettingsIcon,
      disabled: user.role !== 'ADMIN',
      disabledReason: 'Administrator role required',
    },
    {
      id: 'selftests',
      label: 'Self-Tests',
      icon: ClipboardCheck,
      disabled: user.role !== 'ADMIN',
      disabledReason: 'Administrator role required',
    },
    { id: 'help', label: 'Help & Glossary', icon: HelpCircle },
  ];

  const handleSelectNav = (id: NavPage, disabled?: boolean) => {
    if (disabled) return;
    setPage(id);
    setMobileMenuOpen(false);
  };

  const hasDemoWorkspaceData =
    user.is_demo ||
    Boolean(selectedProject?.is_demo) ||
    projects.some((p) => p.is_demo) ||
    usersDirectory.some((u) => u.is_demo && u.is_active !== false);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Calm non-blocking demonstration banner shown only while demo data is active */}
      {hasDemoWorkspaceData && (
        <div
          role="note"
          className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-center text-xs font-medium text-amber-900 flex flex-wrap items-center justify-center gap-3"
        >
          <span>DEMONSTRATION DATA: seeded sample accounts or projects are active in this workspace.</span>
          {user.role === 'ADMIN' && (
            <button
              type="button"
              onClick={() => setPage('settings')}
              className="underline font-semibold text-[#0B2545] hover:text-[#13A3A3] cursor-pointer"
            >
              Switch to Real Workspace
            </button>
          )}
        </div>
      )}

      {/* Top Header Bar */}
      <header className="bg-white border-b border-slate-200 px-4 lg:px-6 py-3 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            className="lg:hidden p-2 rounded-lg text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <ShieldCheck className="w-6 h-6 text-[#0B2545] shrink-0" aria-hidden="true" />
            <span className="text-base font-bold text-[#0B2545] truncate">
              AI Lifecycle &amp; Readiness Assistant
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {/* Simple / Detailed Toggle (Section 16A) */}
          <div
            className="inline-flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200"
            role="group"
            aria-label="Detail display mode"
          >
            <button
              type="button"
              onClick={() => setDetailedMode(false)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                !detailedMode ? 'bg-white text-[#0B2545] shadow-sm' : 'text-slate-600'
              }`}
            >
              Simple
            </button>
            <button
              type="button"
              onClick={() => setDetailedMode(true)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                detailedMode ? 'bg-white text-[#0B2545] shadow-sm' : 'text-slate-600'
              }`}
            >
              Detailed
            </button>
          </div>

          <div className="hidden sm:block text-right leading-tight">
            <div className="text-xs font-semibold text-slate-900">{user.full_name}</div>
            <div className="text-[11px] font-mono text-slate-500">
              {user.role}
              {user.role !== 'PROJECT_OWNER' && reviewerQueueCount > 0
                ? ` · Queue: ${reviewerQueueCount}`
                : ''}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setPwModalOpen(true);
              setPwErr(null);
              setPwOk(null);
            }}
            aria-label="Change password"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <Lock className="w-3.5 h-3.5" aria-hidden="true" /> Password
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar */}
        <aside
          className={`${
            mobileMenuOpen ? 'block fixed inset-y-0 left-0 z-40 pt-16' : 'hidden'
          } lg:block w-64 shrink-0 bg-white border-r border-slate-200 p-4`}
        >
          <nav aria-label="Main navigation" className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = page === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled}
                  title={item.disabled ? item.disabledReason : undefined}
                  onClick={() => handleSelectNav(item.id, item.disabled)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                    item.disabled
                      ? 'text-slate-400 cursor-not-allowed'
                      : active
                      ? 'bg-[#0B2545] text-white cursor-pointer'
                      : 'text-slate-700 hover:bg-slate-100 cursor-pointer'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 min-w-0 p-5 lg:p-8 max-w-7xl mx-auto w-full">
          {globalError && (
            <div
              role="alert"
              className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-900 flex items-center justify-between gap-4"
            >
              <span>{globalError}</span>
              <button
                type="button"
                onClick={() => loadAppData(user)}
                className="px-3 py-1 bg-white border border-rose-300 rounded text-xs font-medium cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {page === 'dashboard' && (
            <DashboardView
              projects={projects}
              selectedProjectId={selectedProject?.id ?? ''}
              onSelectProject={setSelectedProjectId}
              assessment={selectedProject?.latestAssessment ?? null}
              settings={settings}
              detailedMode={detailedMode}
              reviewerQueueCount={reviewerQueueCount}
              user={user}
              onOpenProjectWorkspace={(id) => {
                setSelectedProjectId(id);
                setPage('projects');
              }}
              onOpenProjects={() => setPage('projects')}
              onOpenReviewerQueue={
                user.role !== 'PROJECT_OWNER' ? () => setPage('queue') : undefined
              }
              onRunCheck={handleDashboardRunCheck}
              onLoadSamples={() => handleLoadSampleProjects('all')}
              checking={checkingDash}
            />
          )}

          {page === 'queue' && user.role !== 'PROJECT_OWNER' && (
            <ReviewerQueueView
              detailedMode={detailedMode}
              onOpenProject={(id) => {
                setSelectedProjectId(id);
                setPage('projects');
              }}
            />
          )}

          {page === 'projects' && knowledge && (
            <ProjectWorkspaceView
              projects={projects}
              selectedProjectId={selectedProject?.id ?? ''}
              onSelectProject={setSelectedProjectId}
              knowledge={knowledge}
              user={user}
              usersDirectory={usersDirectory}
              settings={settings}
              detailedMode={detailedMode}
              onProjectsChanged={refreshProjects}
              onNavigateToPolicy={(cid) => {
                setHighlightClauseId(cid ?? null);
                setPage('policies');
              }}
            />
          )}

          {page === 'lifecycle' && knowledge && (
            <KnowledgeGraphView
              knowledge={knowledge}
              projects={projects}
              selectedProjectId={selectedProject?.id ?? ''}
              onSelectProject={setSelectedProjectId}
              selectedAssessment={selectedProject?.latestAssessment ?? null}
            />
          )}

          {page === 'rules' && (
            <RulesView
              rules={rules}
              user={user}
              detailedMode={detailedMode}
              onRefresh={async () => {
                const res = await apiRequest<{ rules: RuleItem[] }>('/rules');
                setRules(res.rules);
              }}
            />
          )}

          {page === 'policies' && (
            <PolicyLibraryView
              clauses={clauses}
              user={user}
              detailedMode={detailedMode}
              highlightClauseId={highlightClauseId}
              onRefresh={async () => {
                const res = await apiRequest<{ clauses: PolicyClauseItem[] }>('/policies');
                setClauses(res.clauses);
              }}
            />
          )}

          {page === 'evaluation' && <EvaluationView user={user} />}

          {page === 'audit' && <AuditLogView user={user} detailedMode={detailedMode} />}

          {page === 'activity' && user.role === 'ADMIN' && (
            <SiteActivityView onUsersOrRequestsChanged={() => loadAppData(user)} />
          )}

          {page === 'settings' && user.role === 'ADMIN' && (
            <SettingsAdminView
              settings={settings}
              section="settings"
              currentUser={user}
              hasDemoData={hasDemoWorkspaceData}
              onSettingsUpdated={() => loadAppData(user)}
              onRealWorkspaceActivated={async (nextUser, csrfToken, sessionToken) => {
                setCsrfToken(csrfToken);
                if (sessionToken) setSessionToken(sessionToken);
                setUser(nextUser);
                await loadAppData(nextUser);
              }}
            />
          )}

          {page === 'selftests' && user.role === 'ADMIN' && (
            <SettingsAdminView
              settings={settings}
              section="selftests"
              currentUser={user}
              hasDemoData={hasDemoWorkspaceData}
              onSettingsUpdated={() => loadAppData(user)}
            />
          )}

          {page === 'help' && (
            <HelpGlossaryView
              onOpenTour={() => setTourOpen(true)}
              user={user}
              onLoadExample={(key) => handleLoadSampleProjects(key)}
            />
          )}
        </main>
      </div>

      {/* Required Footer (Section 14) */}
      <footer className="bg-white border-t border-slate-200 px-6 py-3 text-center text-xs text-slate-500">
        This tool supports human governance boards and does not replace them.
      </footer>

      <WelcomeTourModal open={tourOpen} onClose={() => setTourOpen(false)} />

      {pwModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-pw-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 id="change-pw-title" className="text-lg font-bold text-[#0B2545]">
              Change Password ({user.email})
            </h2>
            {pwErr && (
              <div role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-900">
                {pwErr}
              </div>
            )}
            {pwOk && (
              <div role="status" className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
                {pwOk}
              </div>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setPwErr(null);
                setPwOk(null);
                if (nextPw.length < 8) {
                  setPwErr('New password must be at least 8 characters long.');
                  return;
                }
                if (nextPw !== confirmNextPw) {
                  setPwErr('New passwords do not match.');
                  return;
                }
                try {
                  await apiRequest('/auth/change-password', {
                    method: 'POST',
                    body: JSON.stringify({ currentPassword: curPw, newPassword: nextPw }),
                  });
                  setCurPw('');
                  setNextPw('');
                  setConfirmNextPw('');
                  setPwOk('Password updated successfully.');
                } catch (err) {
                  setPwErr(err instanceof Error ? err.message : 'Unable to update password.');
                }
              }}
              className="space-y-3"
            >
              <div>
                <label htmlFor="self-cur-pw" className="block text-xs font-medium text-slate-700 mb-1">
                  Current Password
                </label>
                <input
                  id="self-cur-pw"
                  type="password"
                  required
                  value={curPw}
                  onChange={(e) => setCurPw(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label htmlFor="self-new-pw" className="block text-xs font-medium text-slate-700 mb-1">
                  New Password (minimum 8 chars)
                </label>
                <input
                  id="self-new-pw"
                  type="password"
                  required
                  value={nextPw}
                  onChange={(e) => setNextPw(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label htmlFor="self-conf-pw" className="block text-xs font-medium text-slate-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  id="self-conf-pw"
                  type="password"
                  required
                  value={confirmNextPw}
                  onChange={(e) => setConfirmNextPw(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPwModalOpen(false)}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm bg-[#0B2545] text-white font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
