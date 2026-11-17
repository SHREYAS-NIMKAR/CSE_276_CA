import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api';
import { SystemSettings, User, UserRole } from '../types';
import { DemoTag } from './UiPrimitives';

interface SelfTestReport {
  ranAt: string;
  total: number;
  passed: number;
  failed: number;
  tests: Array<{ name: string; passed: boolean; durationMs: number; detail: string }>;
}

export function SettingsAdminView({
  settings,
  onSettingsUpdated,
  onRealWorkspaceActivated,
  currentUser,
  hasDemoData = false,
  section,
}: {
  settings: SystemSettings;
  onSettingsUpdated: () => Promise<void>;
  onRealWorkspaceActivated?: (
    user: User,
    csrfToken: string,
    sessionToken?: string
  ) => Promise<void>;
  currentUser?: User;
  hasDemoData?: boolean;
  section: 'settings' | 'selftests';
}) {
  const [form, setForm] = useState<SystemSettings>(settings);
  const [users, setUsers] = useState<User[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Switch to real workspace state
  const [realEmail, setRealEmail] = useState(
    currentUser && !currentUser.is_demo ? currentUser.email : ''
  );
  const [realName, setRealName] = useState(
    currentUser && !currentUser.is_demo ? currentUser.full_name : ''
  );
  const [realPassword, setRealPassword] = useState('');
  const [removeDemoData, setRemoveDemoData] = useState(true);
  const [activatingReal, setActivatingReal] = useState(false);

  // Create user state
  const [uEmail, setUEmail] = useState('');
  const [uName, setUName] = useState('');
  const [uPw, setUPw] = useState('');
  const [uRole, setURole] = useState<UserRole>('PROJECT_OWNER');
  const [uForceChange, setUForceChange] = useState(true);

  // Reset password state
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetForceChange, setResetForceChange] = useState(true);

  // Self-test report
  const [testReport, setTestReport] = useState<SelfTestReport | null>(null);
  const [runningTests, setRunningTests] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  async function loadUsers() {
    const res = await apiRequest<{ users: User[] }>('/users');
    setUsers(res.users);
  }

  useEffect(() => {
    if (section === 'settings') {
      loadUsers();
    }
  }, [section]);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiRequest('/settings', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      await onSettingsUpdated();
      setMsg('Settings saved and all project checks re-run.');
      setTimeout(() => setMsg(null), 4000);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Unable to save settings.');
    }
  }

  async function handleRestoreDefaults() {
    setErr(null);
    try {
      const res = await apiRequest<{ settings: SystemSettings }>('/settings/reset', {
        method: 'POST',
      });
      setForm(res.settings);
      await onSettingsUpdated();
      setMsg('Default settings restored and projects re-checked.');
      setTimeout(() => setMsg(null), 4000);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Unable to restore defaults.');
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiRequest('/users', {
        method: 'POST',
        body: JSON.stringify({
          email: uEmail,
          full_name: uName,
          password: uPw,
          role: uRole,
          force_password_change: uForceChange,
        }),
      });
      setUEmail('');
      setUName('');
      setUPw('');
      await loadUsers();
      setMsg('User registered.');
      setTimeout(() => setMsg(null), 3000);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Failed to create user.');
    }
  }

  async function handleToggleUserActive(u: User) {
    await apiRequest(`/users/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !u.is_active }),
    });
    await loadUsers();
  }

  async function handleChangeUserRole(u: User, role: UserRole) {
    setErr(null);
    try {
      await apiRequest(`/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await loadUsers();
      await onSettingsUpdated();
      setMsg(`Updated role for ${u.email} to ${role}.`);
      setTimeout(() => setMsg(null), 3000);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Unable to update user role.');
    }
  }

  async function handleResetUserPassword(u: User) {
    setErr(null);
    if (resetPw.length < 8) {
      setErr('Temporary password must be at least 8 characters long.');
      return;
    }
    try {
      await apiRequest(`/users/${u.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: resetPw, force_password_change: resetForceChange }),
      });
      setResetUserId(null);
      setResetPw('');
      await loadUsers();
      setMsg(`Password reset for ${u.email}.`);
      setTimeout(() => setMsg(null), 4000);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Unable to reset password.');
    }
  }

  async function handleActivateRealWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setActivatingReal(true);
    try {
      const res = await apiRequest<{
        user: User;
        csrfToken: string;
        sessionToken?: string;
        removedDemoProjects: number;
        removedDemoUsers: number;
      }>('/admin/activate-real-workspace', {
        method: 'POST',
        body: JSON.stringify({
          email: realEmail,
          full_name: realName,
          password: realPassword,
          removeDemoData,
          promoteBaselinePolicies: true,
        }),
      });
      setRealPassword('');
      if (onRealWorkspaceActivated) {
        await onRealWorkspaceActivated(res.user, res.csrfToken, res.sessionToken);
      }
      await loadUsers();
      setMsg(
        `Real workspace activated for ${res.user.email}. Removed ${res.removedDemoProjects} demo projects and ${res.removedDemoUsers} demo accounts.`
      );
      setTimeout(() => setMsg(null), 6000);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Unable to activate real workspace.');
    } finally {
      setActivatingReal(false);
    }
  }

  async function handleRunSelfTests() {
    setRunningTests(true);
    setErr(null);
    try {
      const res = await apiRequest<SelfTestReport>('/admin/self-tests', { method: 'POST' });
      setTestReport(res);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Self-tests failed to run.');
    } finally {
      setRunningTests(false);
    }
  }

  if (section === 'selftests') {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#0B2545]">System Verification &amp; Self-Tests</h1>
            <p className="text-sm text-slate-600 mt-1">
              Runs deterministic server-side tests across scoring, forward chaining, BM25/TF-IDF retrieval, formal risk acceptance, state machine transitions, audit concurrency, and benchmark evaluation.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunSelfTests}
            disabled={runningTests}
            className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
          >
            {runningTests ? 'Running tests...' : 'Run self-tests'}
          </button>
        </div>

        {err && <div role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-900">{err}</div>}

        {testReport && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#0B2545]">
                Latest Test Report: {testReport.passed} / {testReport.total} Passed
              </h2>
              <span className="text-xs font-mono text-slate-500">{testReport.ranAt}</span>
            </div>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
              {testReport.tests.map((t) => (
                <div key={t.name} className="p-3.5 flex items-center justify-between gap-4 text-sm">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {t.passed ? '✔' : '✖'} {t.name}
                    </div>
                    {!t.passed && <div className="text-xs text-rose-700 mt-0.5">{t.detail}</div>}
                  </div>
                  <div className="text-xs font-mono text-slate-500 tabular-nums">{t.durationMs} ms</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#0B2545]">Governance Settings &amp; User Administration</h1>
        <p className="text-sm text-slate-600 mt-1">
          Changes to thresholds or retrieval weights automatically re-run assessments across all projects and are logged in the audit trail.
        </p>
      </div>

      {msg && <div role="status" className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">{msg}</div>}
      {err && <div role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-900">{err}</div>}

      {/* Activate Real Workspace with Your Own Email */}
      <form
        onSubmit={handleActivateRealWorkspace}
        className={`border rounded-xl p-6 space-y-4 ${
          hasDemoData ? 'bg-teal-50/50 border-[#13A3A3]' : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-[#0B2545]">
              {hasDemoData
                ? 'Switch to Real Workspace (Use Your Own Gmail & Clear Demo Data)'
                : 'Real Workspace Active'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Set your own email address (for example, your Gmail) as the real Administrator account, remove seeded demonstration projects and demo accounts, and keep the governance rules &amp; policy library ready for real projects.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="real-admin-email" className="block text-xs font-medium text-slate-700 mb-1">
              Your Real Email (Gmail / Work)
            </label>
            <input
              id="real-admin-email"
              type="email"
              required
              value={realEmail}
              onChange={(e) => setRealEmail(e.target.value)}
              placeholder="you@gmail.com"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label htmlFor="real-admin-name" className="block text-xs font-medium text-slate-700 mb-1">
              Your Full Name
            </label>
            <input
              id="real-admin-name"
              type="text"
              required
              value={realName}
              onChange={(e) => setRealName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label htmlFor="real-admin-pw" className="block text-xs font-medium text-slate-700 mb-1">
              Password (minimum 8 chars)
            </label>
            <input
              id="real-admin-pw"
              type="password"
              required={
                !currentUser ||
                currentUser.is_demo ||
                (realEmail ?? '').trim().toLowerCase() !==
                  (currentUser.email ?? '').trim().toLowerCase()
              }
              value={realPassword}
              onChange={(e) => setRealPassword(e.target.value)}
              placeholder="Choose a strong password"
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={removeDemoData}
              onChange={(e) => setRemoveDemoData(e.target.checked)}
            />
            Remove seeded demo projects &amp; demo accounts (keep baseline rules and policy clauses)
          </label>
          <button
            type="submit"
            disabled={activatingReal}
            className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] disabled:opacity-60 cursor-pointer whitespace-nowrap"
          >
            {activatingReal
              ? 'Activating...'
              : hasDemoData
              ? 'Activate Real Workspace'
              : 'Update Real Admin & Clean Demo Data'}
          </button>
        </div>
      </form>

      {/* Settings Form */}
      <form onSubmit={handleSaveSettings} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <h2 className="text-lg font-bold text-[#0B2545]">Thresholds &amp; Retrieval Parameters</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            ['missingness_threshold', 'Missingness Threshold (0-1)', '0.01'],
            ['parity_tolerance', 'Subgroup Parity Tolerance (0-1)', '0.01'],
            ['readiness_threshold', 'Readiness Threshold (0-1)', '0.05'],
            ['retrieval_high_threshold', 'High Retrieval Confidence', '0.05'],
            ['retrieval_medium_threshold', 'Medium Retrieval Confidence', '0.05'],
            ['hybrid_weight', 'Hybrid BM25 Weight (0-1)', '0.05'],
            ['bm25_k1', 'BM25 k1', '0.1'],
            ['bm25_b', 'BM25 b (0-1)', '0.05'],
          ].map(([key, label, step]) => (
            <div key={key}>
              <label htmlFor={`set-${key}`} className="block text-xs font-medium text-slate-700 mb-1">
                {label}
              </label>
              <input
                id={`set-${key}`}
                type="number"
                step={step}
                value={form[key as keyof SystemSettings]}
                onChange={(e) =>
                  setForm((p) => ({ ...p, [key]: Number(e.target.value) }))
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono tabular-nums"
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
          >
            Save &amp; Re-run Checks
          </button>
          <button
            type="button"
            onClick={handleRestoreDefaults}
            className="px-4 py-2 border border-slate-300 bg-white text-sm font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            Restore Defaults
          </button>
        </div>
      </form>

      {/* User Management */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <h2 className="text-lg font-bold text-[#0B2545]">Administrator User Registration</h2>
        <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label htmlFor="nu-email" className="block text-xs font-medium text-slate-700 mb-1">Email</label>
            <input
              id="nu-email"
              type="email"
              required
              value={uEmail}
              onChange={(e) => setUEmail(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label htmlFor="nu-name" className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
            <input
              id="nu-name"
              required
              value={uName}
              onChange={(e) => setUName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label htmlFor="nu-pw" className="block text-xs font-medium text-slate-700 mb-1">Initial Password</label>
            <input
              id="nu-pw"
              type="password"
              required
              value={uPw}
              onChange={(e) => setUPw(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label htmlFor="nu-role" className="block text-xs font-medium text-slate-700 mb-1">Role</label>
            <select
              id="nu-role"
              value={uRole}
              onChange={(e) => setURole(e.target.value as UserRole)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="PROJECT_OWNER">PROJECT_OWNER</option>
              <option value="REVIEWER">REVIEWER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="RISK_ACCEPTANCE_AUTHORITY">RISK_ACCEPTANCE_AUTHORITY</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={uForceChange}
                onChange={(e) => setUForceChange(e.target.checked)}
              />
              Force password change
            </label>
            <button
              type="submit"
              className="w-full px-4 py-2 bg-[#13A3A3] text-white text-sm font-medium rounded-lg hover:bg-teal-700 cursor-pointer"
            >
              Register User
            </button>
          </div>
        </form>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-left border-collapse text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
              <tr>
                <th className="py-2.5 px-4">User</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-slate-900">
                      {u.full_name} <DemoTag isDemo={u.is_demo} />
                    </div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </td>
                  <td className="py-2.5 px-4">
                    <select
                      aria-label={`Role for ${u.email}`}
                      value={u.role}
                      onChange={(e) => handleChangeUserRole(u, e.target.value as UserRole)}
                      disabled={currentUser?.id === u.id}
                      className="px-2 py-1 border border-slate-300 rounded bg-white font-mono text-xs disabled:opacity-60"
                    >
                      <option value="PROJECT_OWNER">PROJECT_OWNER</option>
                      <option value="REVIEWER">REVIEWER</option>
                      <option value="ADMIN">ADMIN</option>
                      <option value="RISK_ACCEPTANCE_AUTHORITY">RISK_ACCEPTANCE_AUTHORITY</option>
                    </select>
                  </td>
                  <td className="py-2.5 px-4 text-xs">
                    {u.is_active ? 'Active' : 'Deactivated'}
                    {u.force_password_change ? ' · Must change password' : ''}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleToggleUserActive(u)}
                        disabled={currentUser?.id === u.id}
                        className="text-xs underline text-[#0B2545] disabled:opacity-40 cursor-pointer"
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResetUserId(resetUserId === u.id ? null : u.id);
                          setResetPw('');
                        }}
                        className="text-xs underline text-[#13A3A3] cursor-pointer"
                      >
                        Reset password
                      </button>
                    </div>
                    {resetUserId === u.id && (
                      <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2 min-w-[220px]">
                        <input
                          type="password"
                          aria-label={`New temporary password for ${u.email}`}
                          value={resetPw}
                          onChange={(e) => setResetPw(e.target.value)}
                          placeholder="Temp password (8+ chars)"
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs"
                        />
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-700">
                          <input
                            type="checkbox"
                            checked={resetForceChange}
                            onChange={(e) => setResetForceChange(e.target.checked)}
                          />
                          Require change on next login
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleResetUserPassword(u)}
                            className="px-2.5 py-1 bg-[#0B2545] text-white text-xs rounded cursor-pointer"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setResetUserId(null)}
                            className="px-2.5 py-1 bg-white border border-slate-300 text-xs rounded cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
