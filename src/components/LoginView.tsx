import React, { useState } from 'react';
import { ShieldCheck, Lock } from 'lucide-react';
import { apiRequest } from '../api';
import { User } from '../types';

export function LoginView({
  onLoginSuccess,
  expiredBanner,
  needsInitialSetup = false,
}: {
  onLoginSuccess: (user: User, csrfToken: string, sessionToken?: string) => void;
  expiredBanner?: string | null;
  needsInitialSetup?: boolean;
}) {
  const [mode, setMode] = useState<'signin' | 'request'>('signin');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [requestedRole, setRequestedRole] = useState<'PROJECT_OWNER' | 'REVIEWER' | 'RISK_ACCEPTANCE_AUTHORITY'>('PROJECT_OWNER');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isRegistering = needsInitialSetup || mode === 'request';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (isRegistering) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }
    setLoading(true);
    try {
      if (!needsInitialSetup && mode === 'request') {
        const res = await apiRequest<{ message: string }>('/auth/request-access', {
          method: 'POST',
          body: JSON.stringify({
            email,
            full_name: fullName,
            requested_role: requestedRole,
            reason,
            password,
          }),
        });
        setSuccessMsg(res.message);
        setPassword('');
        setConfirmPassword('');
        setReason('');
        return;
      }

      const endpoint = needsInitialSetup ? '/auth/bootstrap' : '/auth/login';
      const payload = needsInitialSetup
        ? { email, full_name: fullName, password }
        : { email, password };
      const res = await apiRequest<{ user: User; csrfToken: string; sessionToken?: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onLoginSuccess(res.user, res.csrfToken, res.sessionToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete request. Please check your details.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-[#0B2545] text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#0B2545] leading-snug">
              AI Lifecycle &amp; Readiness Assistant
            </h1>
            <p className="text-xs text-slate-500">
              {needsInitialSetup ? 'Initial Workspace Setup' : 'AI Governance Portal'}
            </p>
          </div>
        </div>

        {!needsInitialSetup && (
          <div
            role="tablist"
            aria-label="Portal access options"
            className="grid grid-cols-2 p-1 bg-slate-100 rounded-lg border border-slate-200 mb-5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              onClick={() => {
                setMode('signin');
                setError(null);
                setSuccessMsg(null);
              }}
              className={`py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                mode === 'signin' ? 'bg-white text-[#0B2545] shadow-sm' : 'text-slate-600'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'request'}
              onClick={() => {
                setMode('request');
                setError(null);
                setSuccessMsg(null);
              }}
              className={`py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                mode === 'request' ? 'bg-white text-[#0B2545] shadow-sm' : 'text-slate-600'
              }`}
            >
              Request Access
            </button>
          </div>
        )}

        <p className="text-sm text-slate-600 mb-5">
          {needsInitialSetup
            ? 'Create your administrator account using your own email address (for example, your Gmail) to start your governance workspace.'
            : mode === 'request'
            ? 'Submit your email and chosen password to request portal access. Once an administrator approves your request, you can sign in immediately.'
            : 'Sign in with your governance account email and password.'}
        </p>

        {expiredBanner && (
          <div
            role="status"
            className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900"
          >
            {expiredBanner}
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900"
          >
            {successMsg}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegistering && (
            <div>
              <label htmlFor="setup-name" className="block text-sm font-medium text-slate-700 mb-1">
                Full Name
              </label>
              <input
                id="setup-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#13A3A3]"
              />
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1">
              Email Address
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@gmail.com"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#13A3A3]"
            />
          </div>

          {!needsInitialSetup && mode === 'request' && (
            <>
              <div>
                <label htmlFor="req-role" className="block text-sm font-medium text-slate-700 mb-1">
                  Requested Role
                </label>
                <select
                  id="req-role"
                  value={requestedRole}
                  onChange={(e) =>
                    setRequestedRole(
                      e.target.value as 'PROJECT_OWNER' | 'REVIEWER' | 'RISK_ACCEPTANCE_AUTHORITY'
                    )
                  }
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#13A3A3]"
                >
                  <option value="PROJECT_OWNER">Project Owner (register &amp; submit projects)</option>
                  <option value="REVIEWER">Reviewer (verify evidence &amp; approve exceptions)</option>
                  <option value="RISK_ACCEPTANCE_AUTHORITY">Risk Acceptance Authority</option>
                </select>
              </div>
              <div>
                <label htmlFor="req-reason" className="block text-sm font-medium text-slate-700 mb-1">
                  Team / Purpose
                </label>
                <input
                  id="req-reason"
                  type="text"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g., ML engineering team submitting model readiness"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#13A3A3]"
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isRegistering ? 'Minimum 8 characters' : undefined}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#13A3A3]"
            />
          </div>

          {isRegistering && (
            <div>
              <label htmlFor="setup-confirm-pw" className="block text-sm font-medium text-slate-700 mb-1">
                Confirm Password
              </label>
              <input
                id="setup-confirm-pw"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#13A3A3]"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-[#0B2545] hover:bg-[#133863] disabled:opacity-60 text-white font-medium rounded-lg transition-colors cursor-pointer"
          >
            {loading
              ? needsInitialSetup
                ? 'Creating workspace...'
                : mode === 'request'
                ? 'Submitting request...'
                : 'Signing in...'
              : needsInitialSetup
              ? 'Create Admin & Start Workspace'
              : mode === 'request'
              ? 'Submit Access Request'
              : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-xs text-slate-500 text-center">
          This tool supports human governance boards and does not replace them.
        </p>
      </div>
    </div>
  );
}

export function ForcePasswordChangeView({
  user,
  onCompleted,
}: {
  user: User;
  onCompleted: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      onCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-4">
          <Lock className="w-6 h-6 text-[#0B2545]" aria-hidden="true" />
          <h1 className="text-lg font-bold text-[#0B2545]">Password Update Required</h1>
        </div>
        <p className="text-sm text-slate-600 mb-5">
          An administrator required a password change for <strong>{user.full_name}</strong> before continuing.
        </p>
        {error && (
          <div role="alert" className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="cur-pw" className="block text-sm font-medium text-slate-700 mb-1">
              Current Password
            </label>
            <input
              id="cur-pw"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-base"
            />
          </div>
          <div>
            <label htmlFor="new-pw" className="block text-sm font-medium text-slate-700 mb-1">
              New Password (minimum 8 characters)
            </label>
            <input
              id="new-pw"
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-base"
            />
          </div>
          <div>
            <label htmlFor="conf-pw" className="block text-sm font-medium text-slate-700 mb-1">
              Confirm New Password
            </label>
            <input
              id="conf-pw"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-base"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 px-4 bg-[#0B2545] hover:bg-[#133863] text-white font-medium rounded-lg cursor-pointer"
          >
            {saving ? 'Updating...' : 'Update Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
