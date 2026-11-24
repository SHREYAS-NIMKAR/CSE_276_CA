import React, { useState } from 'react';
import { ArrowRight, BookOpen } from 'lucide-react';
import {
  BEGINNER_EXAMPLES,
  BeginnerExampleKey,
  PARAMETER_GUIDE,
} from '../data/beginnerExamples';
import { User } from '../types';

const GLOSSARY_TERMS = [
  ['Artefact', 'A concrete piece of governance evidence (such as a Dataset Datasheet, Subgroup Error Matrix, or Rollback Plan) required during an AI lifecycle stage.'],
  ['Gate (Gs)', 'A binary stage checkpoint (0 or 1). A gate is open/locked (0) if any required blocking artefact in that stage is missing, expired, or unverified.'],
  ['Effective Gate', 'A gate satisfied either because all blocking artefacts are Verified and in date, OR because an approved, in-date exception names that exact rule or artefact.'],
  ['Readiness Score (Rs)', 'Weighted completion score (0% to 100%) for a stage based only on Verified, in-date artefacts. A high Rs never unlocks a missing blocking gate.'],
  ['Forward Chaining', 'A rule-engine inference method that evaluates project facts, fires the highest-priority matching rules, derives new facts (like gate status), and loops until no further rules trigger.'],
  ['BM25', 'A lexical ranking formula that scores how closely a policy clause matches query terms while accounting for term frequency saturation and document length.'],
  ['TF-IDF Cosine', 'A vector-space similarity score comparing rare weighted terms in a query against each policy clause.'],
  ['Exception', 'A temporary, scoped permission approved by a reviewer for a specific rule or artefact. Exceptions allow human review but NEVER authorize release by themselves.'],
  ['Formal Risk Acceptance', 'An explicit, time-bound acceptance of a policy-eligible residual risk recorded only by the Risk Acceptance Authority with written scope and rationale.'],
];

export function HelpGlossaryView({
  onOpenTour,
  user,
  onLoadExample,
}: {
  onOpenTour: () => void;
  user?: User;
  onLoadExample?: (key: BeginnerExampleKey | 'all') => Promise<void>;
}) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const canLoadSamples = Boolean(
    onLoadExample && (!user || user.role === 'ADMIN' || user.role === 'PROJECT_OWNER')
  );

  async function triggerLoad(key: BeginnerExampleKey | 'all') {
    if (!onLoadExample) return;
    setLoadingKey(key);
    setSampleError(null);
    try {
      await onLoadExample(key);
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : 'Unable to load practice project.');
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0B2545]">Help, Student Guides &amp; Glossary</h1>
          <p className="text-sm text-slate-600 mt-1">
            Step-by-step instructions, beginner practice projects, and plain-language definitions for university AI governance.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenTour}
          className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer whitespace-nowrap"
        >
          Reopen Welcome Tour
        </button>
      </div>

      {/* Beginner Practice Projects & Examples */}
      <section
        aria-label="Beginner practice projects and examples"
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1 min-w-[260px]">
            <h2 className="text-lg font-bold text-[#0B2545] flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-[#13A3A3]" aria-hidden="true" />
              Beginner Practice Projects &amp; Examples
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Load ready-made practice projects tagged as DEMO to test <strong>Check my project</strong> and see how Overall Suggestion responds to passing vs. failing values.
            </p>
          </div>
          {canLoadSamples && (
            <button
              type="button"
              disabled={loadingKey !== null}
              onClick={() => triggerLoad('all')}
              className="px-4 py-2 bg-[#0B2545] text-white text-sm font-semibold rounded-lg hover:bg-[#133863] disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              {loadingKey === 'all' ? 'Loading examples...' : 'Load All 3 Demo Projects'}
            </button>
          )}
        </div>

        {sampleError && (
          <div role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-900">
            {sampleError}
          </div>
        )}

        {!canLoadSamples && user && (
          <p className="text-xs text-slate-500">
            Demo practice projects can be loaded by a Project Owner or Administrator account and then inspected across the portal.
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {BEGINNER_EXAMPLES.map((ex) => {
            const toneClass =
              ex.outcomeTone === 'ready'
                ? 'text-emerald-800'
                : ex.outcomeTone === 'blocked'
                ? 'text-rose-800'
                : 'text-amber-800';
            return (
              <div
                key={ex.key}
                className="border border-slate-200 rounded-lg p-4 flex flex-col justify-between gap-4 bg-slate-50/40"
              >
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5 flex-wrap">
                    <span className={`font-semibold ${toneClass}`}>{ex.outcomeLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span>DEMO Template</span>
                  </div>
                  <h3 className="text-sm font-bold text-[#0B2545]">{ex.title}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{ex.summary}</p>
                  <dl className="pt-2 border-t border-slate-200/80 space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-500">Missingness</dt>
                      <dd className="font-mono tabular-nums text-slate-800">{ex.missingnessText}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-500">Fairness Gap</dt>
                      <dd className="font-mono tabular-nums text-slate-800">{ex.fairnessGapText}</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-slate-700 pt-1">
                    <strong>What to test:</strong> {ex.whatYouLearn}
                  </p>
                </div>

                {canLoadSamples && (
                  <button
                    type="button"
                    disabled={loadingKey !== null}
                    onClick={() => triggerLoad(ex.key)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-[#0B2545] hover:bg-slate-100 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                  >
                    {loadingKey === ex.key ? 'Loading...' : 'Load & Open Example'}
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 4 How-To Guides */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <h2 className="text-base font-bold text-[#0B2545]">1. How to Add a Project</h2>
          <p className="text-sm text-slate-700">
            Open the <strong>Projects</strong> workspace and click <strong>New Project</strong>. You can pick a beginner example to prefill the form or enter your own model description, target users, and reviewer.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <h2 className="text-base font-bold text-[#0B2545]">2. How to Add Evidence &amp; Fairness Metrics</h2>
          <p className="text-sm text-slate-700">
            Inside your project&apos;s <strong>Evidence</strong> tab, enter notes, upload supporting files (stored with SHA-256 checksums), and mark each item <em>Submitted</em>. For Stage 3, enter performance values for at least two student cohorts so the server can check parity tolerance.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <h2 className="text-base font-bold text-[#0B2545]">3. How to Read Your Result</h2>
          <p className="text-sm text-slate-700">
            Click <strong>Check my project</strong> to run the rule engine. The <strong>Overall Suggestion</strong> box summarizes what passed and lists up to 3 clear next steps with direct buttons to jump to the right tab.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <h2 className="text-base font-bold text-[#0B2545]">4. How to Ask for an Exception</h2>
          <p className="text-sm text-slate-700">
            If your project uses synthetic data or a third-party model wrapper without raw weights, open <strong>Review and Exceptions</strong> to request a time-bound exception naming the exact item and rationale. An independent reviewer must approve it; exceptions allow review, never automatic release.
          </p>
        </div>
      </div>

      {/* Plain-English Parameter Guide */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#0B2545]">What Parameters Are Tested? (Beginner Cheat Sheet)</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Every check evaluates these 6 plain-English criteria before clearing a project for release.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="py-2 pr-4 font-semibold">Parameter</th>
                <th className="py-2 pr-4 font-semibold">Passing Limit</th>
                <th className="py-2 pr-4 font-semibold">What It Means</th>
                <th className="py-2 font-semibold">Where to Fix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {PARAMETER_GUIDE.map((row) => (
                <tr key={row.parameter}>
                  <td className="py-2.5 pr-4 font-semibold text-[#0B2545] whitespace-nowrap">{row.parameter}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs tabular-nums text-slate-800 whitespace-nowrap">{row.limit}</td>
                  <td className="py-2.5 pr-4 text-slate-700">{row.plainMeaning}</td>
                  <td className="py-2.5 text-xs text-slate-600 whitespace-nowrap">{row.whereToTest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Glossary */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-bold text-[#0B2545]">Governance Glossary</h2>
        <dl className="divide-y divide-slate-200">
          {GLOSSARY_TERMS.map(([term, def]) => (
            <div key={term} className="py-3 grid grid-cols-1 md:grid-cols-4 gap-2">
              <dt className="font-bold text-sm text-[#0B2545]">{term}</dt>
              <dd className="md:col-span-3 text-sm text-slate-700">{def}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Technical Documentation Overview */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2 text-sm text-slate-700">
        <h2 className="text-lg font-bold text-[#0B2545]">System Architecture &amp; API Documentation</h2>
        <p>
          All rule execution, scoring, BM25/TF-IDF policy retrieval, fairness gap computation, workflow state validation, and SHA-256 hash-chained audit logging execute strictly on the server.
          Interactive API documentation is served at <a href="/api/docs" target="_blank" rel="noreferrer" className="text-[#13A3A3] underline">/api/docs</a> and the OpenAPI 3.0.3 schema is available at <a href="/api/openapi.json" target="_blank" rel="noreferrer" className="text-[#13A3A3] underline">/api/openapi.json</a>.
        </p>
      </div>
    </div>
  );
}
