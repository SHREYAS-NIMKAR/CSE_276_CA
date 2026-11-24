import React from 'react';
import { ArrowRight, CheckCircle2, ClipboardList, Lightbulb } from 'lucide-react';
import { OverallSuggestion, SuggestedTab } from '../utils/overallSuggestion';

export function OverallSuggestionCard({
  suggestion,
  onNavigateTab,
  onOpenWorkspace,
}: {
  suggestion: OverallSuggestion;
  onNavigateTab?: (tab: SuggestedTab) => void;
  onOpenWorkspace?: () => void;
}) {
  const surfaceClass =
    suggestion.tone === 'ready'
      ? 'bg-emerald-50/60 border-emerald-200'
      : suggestion.tone === 'attention'
      ? 'bg-amber-50/60 border-amber-200'
      : 'bg-slate-50 border-slate-200';

  const headingColor =
    suggestion.tone === 'ready'
      ? 'text-emerald-950'
      : suggestion.tone === 'attention'
      ? 'text-amber-950'
      : 'text-[#0B2545]';

  return (
    <section
      aria-label="Overall suggestion"
      className={`border rounded-xl p-5 space-y-4 ${surfaceClass}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5 max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            {suggestion.tone === 'ready' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
            ) : (
              <Lightbulb className="w-4 h-4 text-[#0B2545] shrink-0" aria-hidden="true" />
            )}
            <span>Overall Suggestion</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {suggestion.counts.verified}/{suggestion.counts.total} verified
            </span>
            {suggestion.counts.awaitingVerification > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">
                  {suggestion.counts.awaitingVerification} awaiting verification
                </span>
              </>
            )}
            {suggestion.counts.blockingRemaining > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums text-rose-700">
                  {suggestion.counts.blockingRemaining} critical remaining
                </span>
              </>
            )}
          </div>
          <h3 className={`text-base font-bold ${headingColor}`}>{suggestion.headline}</h3>
          <p className="text-sm text-slate-700 leading-relaxed">{suggestion.plainSummary}</p>
        </div>

        {onOpenWorkspace && (
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0B2545] text-white text-xs font-semibold rounded-lg hover:bg-[#133863] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />
            Open Project &amp; Fix Next
          </button>
        )}
      </div>

      {suggestion.steps.length > 0 && (
        <div className="border-t border-slate-200/80 pt-3.5 space-y-2">
          <div className="text-xs font-semibold text-slate-600">Recommended Next Steps</div>
          <ol className="divide-y divide-slate-200/80 bg-white border border-slate-200 rounded-lg">
            {suggestion.steps.map((step) => (
              <li
                key={step.stepNumber}
                className="p-3.5 flex flex-wrap sm:flex-nowrap items-start justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span className="text-xs font-mono font-bold text-[#0B2545] tabular-nums pt-0.5 shrink-0">
                    {String(step.stepNumber).padStart(2, '0')}.
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#0B2545]">{step.title}</div>
                    <p className="text-sm text-slate-600 mt-0.5">{step.description}</p>
                  </div>
                </div>

                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab(step.targetTab)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 bg-white text-xs font-semibold text-[#0B2545] rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {step.actionLabel}
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
