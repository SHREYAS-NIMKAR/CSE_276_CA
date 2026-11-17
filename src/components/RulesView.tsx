import React, { useState } from 'react';
import { apiRequest } from '../api';
import { RuleItem, User } from '../types';

export function RulesView({
  rules,
  user,
  detailedMode,
  onRefresh,
}: {
  rules: RuleItem[];
  user: User;
  detailedMode: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [confirmBlocking, setConfirmBlocking] = useState<RuleItem | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = rules.filter((r) => {
    if (typeFilter !== 'ALL' && r.type !== typeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.condition_summary.toLowerCase().includes(q) ||
        r.action_summary.toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function toggleRule(rule: RuleItem, nextEnabled: boolean) {
    if (!nextEnabled && rule.type === 'BLOCKING' && !confirmBlocking) {
      setConfirmBlocking(rule);
      return;
    }
    setConfirmBlocking(null);
    await apiRequest(`/rules/${rule.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: nextEnabled }),
    });
    await onRefresh();
    setFeedback(`Rule ${rule.id} ${nextEnabled ? 'enabled' : 'disabled'}.`);
    setTimeout(() => setFeedback(null), 3000);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0B2545]">Forward-Chaining Production Rules</h1>
        <p className="text-sm text-slate-600 mt-1">
          Rules execute iteratively in priority order (Blocking → Exception → Warning → Info) until no new facts are derived.
        </p>
      </div>

      {feedback && (
        <div role="status" className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
          {feedback}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="rule-search" className="sr-only">
            Search rules
          </label>
          <input
            id="rule-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rules by ID, condition, or action..."
            className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          {['ALL', 'BLOCKING', 'EXCEPTION', 'WARNING', 'INFO'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
                typeFilter === t ? 'bg-white text-[#0B2545] shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
            <tr>
              <th className="py-3 px-4">Rule</th>
              <th className="py-3 px-4">Type / Priority</th>
              <th className="py-3 px-4">Condition &amp; Action</th>
              <th className="py-3 px-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-sm">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/70">
                <td className="py-3.5 px-4 align-top">
                  <div className="font-mono text-xs font-bold text-[#0B2545]">{r.id}</div>
                  <div className="font-semibold text-slate-900">{r.name}</div>
                  {detailedMode && (
                    <div className="text-xs font-mono text-slate-500 mt-1">
                      Req: {r.supported_governance_req} · Stage {r.stage}
                      {r.dependencies.length > 0 ? ` · Depends on: ${r.dependencies.join(', ')}` : ''}
                    </div>
                  )}
                </td>
                <td className="py-3.5 px-4 align-top whitespace-nowrap">
                  <div className="font-mono text-xs font-bold text-slate-800">{r.type}</div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    Priority {r.priority} · {r.severity}
                  </div>
                </td>
                <td className="py-3.5 px-4 align-top">
                  <div className="text-slate-800">{r.condition_summary}</div>
                  <div className="text-xs text-slate-600 mt-1">→ {r.action_summary}</div>
                </td>
                <td className="py-3.5 px-4 align-top whitespace-nowrap">
                  {user.role === 'ADMIN' ? (
                    <button
                      type="button"
                      onClick={() => toggleRule(r, !r.enabled)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                        r.enabled
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                          : 'bg-slate-100 border-slate-300 text-slate-600'
                      }`}
                    >
                      {r.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  ) : (
                    <span className="text-xs font-medium text-slate-700">
                      {r.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Warning modal when disabling a BLOCKING rule */}
      {confirmBlocking && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-bold text-rose-800">
              Confirm Disabling Blocking Rule {confirmBlocking.id}
            </h2>
            <p className="text-sm text-slate-700">
              You are about to disable <strong>{confirmBlocking.name}</strong> ({confirmBlocking.type}). Disabled rules never fire during governance checks, and this change is permanently recorded in the audit log.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmBlocking(null)}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => toggleRule(confirmBlocking, false)}
                className="px-4 py-2 text-sm bg-rose-700 text-white font-medium rounded-lg hover:bg-rose-800 cursor-pointer"
              >
                Confirm Disable Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
