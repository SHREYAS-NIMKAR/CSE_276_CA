import React, { useState } from 'react';
import { X } from 'lucide-react';

const TOUR_STEPS = [
  {
    title: '1. Left Navigation Sidebar',
    body: 'Use the sidebar to switch between your Dashboard, Projects workspace, the 6-stage Lifecycle Model, Governance Rules, Policy Library, Benchmark Evaluation, and Audit Log. Items restricted to other roles show why they are unavailable.',
  },
  {
    title: '2. Project Workspace Tabs',
    body: 'Open any project to work through its six organised tabs: Overview, Evidence (all 6 stages + Stage 3 Fairness Check), Risks and Guidance, Rule Trace, Review and Exceptions, and Report & Export.',
  },
  {
    title: '3. Check My Project Button',
    body: 'Whenever you update evidence or cohort metrics, click "Check my project" at the top of the workspace. The server runs the forward-chaining rule engine, stage gates, and policy retrieval live.',
  },
  {
    title: '4. Reading Your Result Panel',
    body: 'The result panel shows your release status banner, what is missing, why it matters, and how to fix it using retrieved policy clauses. Use the Simple / Detailed toggle in the top bar whenever you want to inspect rule IDs, scores, and traces.',
  },
];

export function WelcomeTourModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  if (!open) return null;

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-xs font-medium text-[#13A3A3]">
              Quick Tour · Step {step + 1} of {TOUR_STEPS.length}
            </p>
            <h2 id="tour-title" className="text-xl font-bold text-[#0B2545] mt-1">
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Skip welcome tour"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-base text-slate-700 leading-relaxed mb-6">{current.body}</p>

        <div className="flex items-center justify-between gap-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="px-4 py-2 text-sm font-medium border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Back
              </button>
            )}
            {!isLast ? (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                className="px-4 py-2 text-sm font-medium bg-[#0B2545] text-white rounded-lg hover:bg-[#133863] cursor-pointer"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium bg-[#13A3A3] text-white rounded-lg hover:bg-teal-700 cursor-pointer"
              >
                Finish tour
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
