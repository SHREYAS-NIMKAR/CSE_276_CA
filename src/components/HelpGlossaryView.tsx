import React from 'react';

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

export function HelpGlossaryView({ onOpenTour }: { onOpenTour: () => void }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0B2545]">Help, Student Guides &amp; Glossary</h1>
          <p className="text-sm text-slate-600 mt-1">
            Step-by-step instructions and plain-language definitions for university AI governance.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenTour}
          className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
        >
          Reopen Welcome Tour
        </button>
      </div>

      {/* 4 How-To Guides */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <h2 className="text-base font-bold text-[#0B2545]">1. How to Add a Project</h2>
          <p className="text-sm text-slate-700">
            Open the <strong>Projects</strong> workspace and click <strong>New Project</strong>. Describe what your model does, who uses it, whether it affects student academic standing, and select an independent reviewer. The server checks for contradictory classifications automatically.
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
            Click <strong>Check my project</strong> to run the rule engine. The result panel shows whether release is locked, what is missing, why it matters, and how to fix it using grounded university policy clauses. Switch to <strong>Detailed</strong> in the top bar to see rule IDs, scores, and traces.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <h2 className="text-base font-bold text-[#0B2545]">4. How to Ask for an Exception</h2>
          <p className="text-sm text-slate-700">
            If your project uses synthetic data or a third-party model wrapper without raw weights, open <strong>Review and Exceptions</strong> to request a time-bound exception naming the exact item and rationale. An independent reviewer must approve it; exceptions allow review, never automatic release.
          </p>
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
