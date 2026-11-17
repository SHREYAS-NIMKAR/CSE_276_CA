import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { apiRequest } from '../api';
import { PolicyClauseItem, RetrievedClauseHit, User } from '../types';
import { DemoTag, HelpTooltip } from './UiPrimitives';

export function PolicyLibraryView({
  clauses,
  user,
  detailedMode,
  highlightClauseId,
  onRefresh,
}: {
  clauses: PolicyClauseItem[];
  user: User;
  detailedMode: boolean;
  highlightClauseId?: string | null;
  onRefresh: () => Promise<void>;
}) {
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [textFilter, setTextFilter] = useState('');
  const [query, setQuery] = useState('subgroup error matrix academic standing fairness');
  const [searchResults, setSearchResults] = useState<RetrievedClauseHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Admin add clause state
  const [showAdd, setShowAdd] = useState(false);
  const [newId, setNewId] = useState('');
  const [newSource, setNewSource] = useState('University AI Governance Policy');
  const [newSection, setNewSection] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newText, setNewText] = useState('');
  const [newTags, setNewTags] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const sources = Array.from(new Set(clauses.map((c) => c.source)));

  const filtered = clauses.filter((c) => {
    if (sourceFilter !== 'ALL' && c.source !== sourceFilter) return false;
    if (textFilter.trim()) {
      const q = textFilter.toLowerCase();
      return (
        c.clause_id.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.text.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  async function handleTestRetrieval(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setErr(null);
    try {
      const res = await apiRequest<{ results: RetrievedClauseHit[] }>('/policies/search', {
        method: 'POST',
        body: JSON.stringify({ query, topK: 6 }),
      });
      setSearchResults(res.results);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }

  async function handleAddClause(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiRequest('/policies', {
        method: 'POST',
        body: JSON.stringify({
          clause_id: newId,
          source: newSource,
          section_number: newSection,
          title: newTitle,
          text: newText,
          tags: newTags.split(',').map((s) => s.trim()).filter(Boolean),
          related_clause_ids: [],
        }),
      });
      setShowAdd(false);
      setNewId('');
      setNewSection('');
      setNewTitle('');
      setNewText('');
      setNewTags('');
      await onRefresh();
      setMsg('Policy clause added.');
      setTimeout(() => setMsg(null), 3000);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not add clause.');
    }
  }

  async function handleToggleActive(c: PolicyClauseItem) {
    await apiRequest(`/policies/${c.clause_id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !c.is_active }),
    });
    await onRefresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0B2545]">Policy Library &amp; Retrieval Tester</h1>
          <p className="text-sm text-amber-800 font-medium mt-1">
            Demonstration corpus: replace with your institution&apos;s real policies ({clauses.length} clauses).
          </p>
        </div>
        {user.role === 'ADMIN' && (
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
          >
            {showAdd ? 'Close Form' : 'Add Policy Clause'}
          </button>
        )}
      </div>

      {msg && (
        <div role="status" className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
          {msg}
        </div>
      )}
      {err && (
        <div role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-900">
          {err}
        </div>
      )}

      {/* Admin Add Clause Form */}
      {showAdd && user.role === 'ADMIN' && (
        <form onSubmit={handleAddClause} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-base font-bold text-[#0B2545]">Add New Policy Clause</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              required
              placeholder="Clause ID (e.g. UAIGP-7.1)"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <input
              required
              placeholder="Source name"
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <input
              required
              placeholder="Section (e.g. 7.1)"
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <input
            required
            placeholder="Clause Title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <textarea
            required
            rows={2}
            placeholder="Clause policy text..."
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <input
            placeholder="Comma-separated tags (e.g. privacy, consent, stage 1)"
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
          >
            Save Policy Clause
          </button>
        </form>
      )}

      {/* Retrieval Testing Tool */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-[#0B2545]">
            Hybrid Retrieval Tester (BM25 + TF-IDF Cosine)
          </h2>
          <HelpTooltip
            term="BM25 & TF-IDF Hybrid Retrieval"
            text="Combines normalized BM25 keyword relevance and TF-IDF cosine similarity (both implemented from scratch on the server) using the configured hybrid weight."
          />
        </div>
        <form onSubmit={handleTestRetrieval} className="flex flex-wrap gap-3">
          <input
            type="text"
            aria-label="Test retrieval query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a governance question or artefact name..."
            className="flex-1 min-w-[260px] px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#13A3A3] text-white text-sm font-medium rounded-lg hover:bg-teal-700 cursor-pointer"
          >
            <Search className="w-4 h-4" />
            {searching ? 'Searching...' : 'Test Retrieval'}
          </button>
        </form>

        {searchResults && (
          <div className="space-y-3 pt-2">
            {searchResults.map((hit) => (
              <div key={hit.clauseId} className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-sm text-[#0B2545]">
                    {hit.clauseId} · {hit.title}
                  </div>
                  <div className="text-xs font-medium text-slate-700">
                    {hit.confidenceLabel} ({hit.confidence})
                  </div>
                </div>
                <p className="text-sm text-slate-700">{hit.text}</p>
                <div className="text-xs text-slate-600">
                  <strong>Why this clause:</strong> matched terms [{hit.matchedTerms.join(', ') || 'none'}]
                  {detailedMode && (
                    <span className="font-mono ml-2">
                      · Hybrid={hit.hybridScore.toFixed(3)} (BM25={hit.bm25Score.toFixed(3)}, TF-IDF={hit.tfidfScore.toFixed(3)})
                    </span>
                  )}
                </div>
                {hit.relatedClauses.length > 0 && (
                  <div className="text-xs text-slate-600 pt-1 border-t border-slate-200">
                    <strong>Related requirement (2-hop):</strong>{' '}
                    {hit.relatedClauses.map((rc) => `${rc.clauseId} (${rc.title})`).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Browse & Filter Clauses */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            aria-label="Filter policy clauses"
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
            placeholder="Filter clauses by keyword, ID, or tag..."
            className="flex-1 min-w-[220px] px-3.5 py-2 border border-slate-300 rounded-lg text-sm"
          />
          <select
            aria-label="Filter by source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          >
            <option value="ALL">All Sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="divide-y divide-slate-200">
          {filtered.map((c) => (
            <div
              key={c.clause_id}
              className={`py-4 space-y-1 ${
                highlightClauseId === c.clause_id ? 'bg-teal-50/60 px-3 rounded-lg' : ''
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-[#0B2545]">
                  <span className="font-mono mr-2">{c.clause_id}</span>
                  {c.title}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <DemoTag isDemo={c.is_demo} />
                  <span>{c.source} · Sec. {c.section_number}</span>
                  {user.role === 'ADMIN' && (
                    <button
                      type="button"
                      onClick={() => handleToggleActive(c)}
                      className="underline text-[#0B2545] cursor-pointer"
                    >
                      {c.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-slate-700">{c.text}</p>
              <div className="text-xs text-slate-500">
                Tags: {c.tags.join(' · ')}
                {c.related_clause_ids.length > 0 && ` | Related: ${c.related_clause_ids.join(', ')}`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
