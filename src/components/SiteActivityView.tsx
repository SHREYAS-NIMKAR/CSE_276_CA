import React, { useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, UserCheck, Users } from 'lucide-react';
import { apiRequest } from '../api';
import { UserRole } from '../types';

interface ActivityResponse {
  stats: {
    totalVisits: number;
    uniqueIps24h: number;
    activeSessionCount: number;
    pendingAccessRequests: number;
  };
  visits: Array<{
    id: string;
    visited_at: string;
    ip_address: string;
    user_agent: string;
    path: string;
    referrer: string | null;
    user_id: string | null;
    user_email: string | null;
  }>;
  activeSessions: Array<{
    id: string;
    user_id: string;
    email: string;
    full_name: string;
    role: UserRole;
    ip_address: string;
    user_agent: string;
    created_at: string;
    last_seen_at: string;
    expires_at: string;
    isCurrentSession: boolean;
  }>;
  accessRequests: Array<{
    id: string;
    email: string;
    full_name: string;
    requested_role: UserRole;
    reason: string;
    status: 'Pending' | 'Approved' | 'Rejected';
    source_ip: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
  }>;
}

export function SiteActivityView({
  onUsersOrRequestsChanged,
}: {
  onUsersOrRequestsChanged?: () => Promise<void>;
}) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [roleOverrides, setRoleOverrides] = useState<Record<string, UserRole>>({});

  async function loadActivity() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<ActivityResponse>('/admin/activity');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load site activity.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadActivity();
  }, []);

  async function handleDecideRequest(id: string, decision: 'Approved' | 'Rejected', defaultRole: UserRole) {
    setError(null);
    try {
      const assignedRole = roleOverrides[id] || defaultRole;
      await apiRequest(`/admin/access-requests/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision, assignedRole }),
      });
      await loadActivity();
      if (onUsersOrRequestsChanged) await onUsersOrRequestsChanged();
      setMsg(`Access request ${decision.toLowerCase()}.`);
      setTimeout(() => setMsg(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process access request.');
    }
  }

  async function handleRevokeSession(sessionId: string) {
    setError(null);
    try {
      await apiRequest(`/admin/sessions/${sessionId}`, { method: 'DELETE' });
      await loadActivity();
      setMsg('Session revoked and signed out.');
      setTimeout(() => setMsg(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revoke session.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0B2545]">Site Activity, Visitors &amp; Access</h1>
          <p className="text-sm text-slate-600 mt-1">
            Monitor recent site visitors, manage live signed-in sessions, and approve or reject new user access requests.
          </p>
        </div>
        <button
          type="button"
          onClick={loadActivity}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 bg-white text-sm font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {msg && (
        <div role="status" className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
          {msg}
        </div>
      )}
      {error && (
        <div role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-900">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">Total Recorded Visits</div>
              <div className="text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">{data.stats.totalVisits}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">Unique Visitor IPs (24h)</div>
              <div className="text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">{data.stats.uniqueIps24h}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">Active Signed-In Sessions</div>
              <div className="text-2xl font-bold text-[#13A3A3] mt-1 tabular-nums">{data.stats.activeSessionCount}</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">Pending Access Requests</div>
              <div className="text-2xl font-bold text-[#0B2545] mt-1 tabular-nums">
                {data.stats.pendingAccessRequests}
              </div>
            </div>
          </div>

          {/* Access Requests */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-[#0B2545]" aria-hidden="true" />
              <h2 className="text-lg font-bold text-[#0B2545]">Access Requests</h2>
            </div>
            {data.accessRequests.length === 0 ? (
              <p className="text-sm text-slate-500">No access requests have been submitted yet.</p>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                    <tr>
                      <th className="py-2.5 px-4">Applicant</th>
                      <th className="py-2.5 px-4">Reason</th>
                      <th className="py-2.5 px-4">Role</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {data.accessRequests.map((ar) => (
                      <tr key={ar.id}>
                        <td className="py-2.5 px-4 align-top">
                          <div className="font-medium text-slate-900">{ar.full_name}</div>
                          <div className="text-xs text-slate-500">{ar.email}</div>
                          <div className="text-[11px] text-slate-400">
                            {ar.created_at.slice(0, 19).replace('T', ' ')}
                            {ar.source_ip ? ` · ${ar.source_ip}` : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 align-top text-slate-700 max-w-xs">{ar.reason}</td>
                        <td className="py-2.5 px-4 align-top">
                          {ar.status === 'Pending' ? (
                            <select
                              aria-label={`Assign role for ${ar.email}`}
                              value={roleOverrides[ar.id] || ar.requested_role}
                              onChange={(e) =>
                                setRoleOverrides((prev) => ({
                                  ...prev,
                                  [ar.id]: e.target.value as UserRole,
                                }))
                              }
                              className="px-2 py-1 border border-slate-300 rounded bg-white font-mono text-xs"
                            >
                              <option value="PROJECT_OWNER">PROJECT_OWNER</option>
                              <option value="REVIEWER">REVIEWER</option>
                              <option value="RISK_ACCEPTANCE_AUTHORITY">RISK_ACCEPTANCE_AUTHORITY</option>
                              <option value="ADMIN">ADMIN</option>
                            </select>
                          ) : (
                            <span className="font-mono text-xs">{ar.requested_role}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 align-top text-xs font-semibold">
                          {ar.status}
                        </td>
                        <td className="py-2.5 px-4 align-top whitespace-nowrap">
                          {ar.status === 'Pending' ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleDecideRequest(ar.id, 'Approved', ar.requested_role)}
                                className="px-2.5 py-1 bg-[#0B2545] text-white text-xs font-medium rounded hover:bg-[#133863] cursor-pointer"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDecideRequest(ar.id, 'Rejected', ar.requested_role)}
                                className="px-2.5 py-1 border border-rose-200 text-rose-700 text-xs font-medium rounded hover:bg-rose-50 cursor-pointer"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">Processed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Active Sessions */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-[#0B2545]" aria-hidden="true" />
              <h2 className="text-lg font-bold text-[#0B2545]">Active Signed-In Sessions</h2>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                  <tr>
                    <th className="py-2.5 px-4">User</th>
                    <th className="py-2.5 px-4">IP &amp; Browser</th>
                    <th className="py-2.5 px-4">Last Seen</th>
                    <th className="py-2.5 px-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.activeSessions.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2.5 px-4 align-top">
                        <div className="font-medium text-slate-900">
                          {s.full_name} {s.isCurrentSession ? '(This session)' : ''}
                        </div>
                        <div className="text-xs text-slate-500">
                          {s.email} · <span className="font-mono">{s.role}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 align-top text-xs text-slate-600">
                        <div className="font-mono">{s.ip_address}</div>
                        <div className="text-[11px] text-slate-400 max-w-xs truncate" title={s.user_agent}>
                          {s.user_agent}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 align-top text-xs text-slate-600 whitespace-nowrap tabular-nums">
                        {s.last_seen_at.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="py-2.5 px-4 align-top">
                        <button
                          type="button"
                          disabled={s.isCurrentSession}
                          onClick={() => handleRevokeSession(s.id)}
                          className="text-xs underline text-rose-700 disabled:opacity-40 cursor-pointer"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Site Visitors */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-[#0B2545]" aria-hidden="true" />
              <h2 className="text-lg font-bold text-[#0B2545]">Recent Site Visitors</h2>
            </div>
            {data.visits.length === 0 ? (
              <p className="text-sm text-slate-500">No page visits recorded yet.</p>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                    <tr>
                      <th className="py-2.5 px-4">Time</th>
                      <th className="py-2.5 px-4">Visitor / User</th>
                      <th className="py-2.5 px-4">IP Address</th>
                      <th className="py-2.5 px-4">Path &amp; Browser</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {data.visits.map((v) => (
                      <tr key={v.id}>
                        <td className="py-2.5 px-4 align-top text-xs text-slate-600 whitespace-nowrap tabular-nums">
                          {v.visited_at.slice(0, 19).replace('T', ' ')}
                        </td>
                        <td className="py-2.5 px-4 align-top text-xs">
                          {v.user_email ? (
                            <span className="font-medium text-slate-900">{v.user_email}</span>
                          ) : (
                            <span className="text-slate-500">Guest visitor</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 align-top font-mono text-xs text-slate-700">
                          {v.ip_address}
                        </td>
                        <td className="py-2.5 px-4 align-top text-xs text-slate-600">
                          <div className="font-mono">{v.path}</div>
                          <div className="text-[11px] text-slate-400 max-w-md truncate" title={v.user_agent}>
                            {v.user_agent}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
