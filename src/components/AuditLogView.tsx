import React, { useEffect, useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';
import { apiRequest, downloadAuthedFile } from '../api';
import { AuditEntryItem, User } from '../types';
import { DemoTag } from './UiPrimitives';

export function AuditLogView({
  user,
  detailedMode,
}: {
  user: User;
  detailedMode: boolean;
}) {
  const [entries, setEntries] = useState<AuditEntryItem[]>([]);
  const [postgresNote, setPostgresNote] = useState('');
  const [hiddenDemoCount, setHiddenDemoCount] = useState(0);
  const [includeDemo, setIncludeDemo] = useState(Boolean(user.is_demo));
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [verifyResult, setVerifyResult] = useState<{
    valid: boolean;
    totalEntries: number;
    brokenAtSeq: number | null;
    reason: string | null;
  } | null>(null);

  async function loadAudit(nextIncludeDemo = includeDemo) {
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (actionFilter) params.set('action', actionFilter);
    params.set('includeDemo', nextIncludeDemo ? 'true' : 'false');
    const res = await apiRequest<{
      entries: AuditEntryItem[];
      hiddenDemoCount: number;
      postgresNote: string;
    }>(`/audit?${params.toString()}`);
    setEntries(res.entries);
    setHiddenDemoCount(res.hiddenDemoCount ?? 0);
    setPostgresNote(res.postgresNote);
  }

  useEffect(() => {
    loadAudit(includeDemo);
  }, [actionFilter, includeDemo]);

  async function handleVerify() {
    const res = await apiRequest<{
      valid: boolean;
      totalEntries: number;
      brokenAtSeq: number | null;
      reason: string | null;
    }>('/audit/verify', { method: 'POST' });
    setVerifyResult(res);
    await loadAudit(includeDemo);
  }

  const actions = Array.from(new Set(entries.map((e) => e.action))).sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0B2545]">Append-Only Governance Audit Log</h1>
          <p className="text-sm text-slate-600 mt-1">{postgresNote}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              downloadAuthedFile(
                `/audit/export.csv?includeDemo=${includeDemo ? 'true' : 'false'}`,
                'audit-log.csv'
              )
            }
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 bg-white text-sm font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          {user.role === 'ADMIN' && (
            <button
              type="button"
              onClick={handleVerify}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" /> Verify audit chain
            </button>
          )}
        </div>
      </div>

      {verifyResult && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-sm font-medium ${
            verifyResult.valid
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {verifyResult.valid
            ? `✔ Audit chain verified across ${verifyResult.totalEntries} entries with zero breaks or forks.`
            : `✖ Chain break detected at sequence #${verifyResult.brokenAtSeq}: ${verifyResult.reason}`}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          aria-label="Search audit log"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadAudit(includeDemo)}
          placeholder="Search details, action, email, or IP..."
          className="flex-1 min-w-[220px] px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
        />
        <select
          aria-label="Filter by action"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
        >
          <option value="">All Actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {(hiddenDemoCount > 0 || includeDemo) && (
          <label className="flex items-center gap-2 text-xs text-slate-600 px-2">
            <input
              type="checkbox"
              checked={includeDemo}
              onChange={(e) => setIncludeDemo(e.target.checked)}
            />
            Include historical demo entries{hiddenDemoCount > 0 ? ` (${hiddenDemoCount} hidden)` : ''}
          </label>
        )}
        <button
          type="button"
          onClick={() => loadAudit(includeDemo)}
          className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
        >
          Search
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
            <tr>
              <th className="py-3 px-4">Seq / Time</th>
              <th className="py-3 px-4">Actor &amp; IP</th>
              <th className="py-3 px-4">Action</th>
              <th className="py-3 px-4">Details</th>
              {detailedMode && <th className="py-3 px-4">SHA-256 Chain</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={detailedMode ? 5 : 4} className="py-8 px-4 text-center text-slate-500">
                  No audit entries match the current filter.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.seq_num} className="hover:bg-slate-50/60">
                  <td className="py-3 px-4 align-top whitespace-nowrap tabular-nums">
                    <div className="font-mono text-xs font-bold text-[#0B2545]">#{e.seq_num}</div>
                    <div className="text-xs text-slate-500">{e.created_at.slice(0, 19).replace('T', ' ')}</div>
                  </td>
                  <td className="py-3 px-4 align-top">
                    <div className="font-medium text-slate-900">{e.user_email ?? 'system'}</div>
                    <div className="text-xs text-slate-500">
                      {e.user_role}
                      {e.source_ip ? ` · ${e.source_ip}` : ''}
                    </div>
                  </td>
                  <td className="py-3 px-4 align-top whitespace-nowrap">
                    <span className="font-mono text-xs font-semibold text-[#0B2545]">{e.action}</span>{' '}
                    <DemoTag isDemo={e.is_demo} />
                  </td>
                  <td className="py-3 px-4 align-top">
                    <div className="text-slate-800">{e.details}</div>
                    {e.rationale && <div className="text-xs text-slate-500 mt-0.5">Rationale: {e.rationale}</div>}
                  </td>
                  {detailedMode && (
                    <td className="py-3 px-4 align-top font-mono text-xs text-slate-500 whitespace-nowrap">
                      <div>hash: {e.entry_hash.slice(0, 12)}...</div>
                      <div>prev: {e.prev_hash.slice(0, 12)}...</div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
