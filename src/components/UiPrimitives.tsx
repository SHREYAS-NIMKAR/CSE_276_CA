import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Circle, HelpCircle } from 'lucide-react';
import { StageSummary, RiskSummary } from '../types';

export function StatusIndicator({
  status,
  label,
}: {
  status: 'done' | 'attention' | 'blocked' | 'not_started';
  label?: string;
}) {
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>{label ?? 'Done'}</span>
      </span>
    );
  }
  if (status === 'attention') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 whitespace-nowrap">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>{label ?? 'Needs attention'}</span>
      </span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-700 whitespace-nowrap">
        <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>{label ?? 'Blocked'}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 whitespace-nowrap">
      <Circle className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>{label ?? 'Not started'}</span>
    </span>
  );
}

export function mapStageWordToStatus(word: StageSummary['statusWord']) {
  if (word === 'Done') return 'done' as const;
  if (word === 'Blocked') return 'blocked' as const;
  if (word === 'Needs attention') return 'attention' as const;
  return 'not_started' as const;
}

export function DemoTag({ isDemo }: { isDemo?: boolean }) {
  if (!isDemo) return null;
  return (
    <span className="font-mono text-xs font-semibold tracking-wide text-amber-800 uppercase">
      DEMO
    </span>
  );
}

export function HelpTooltip({ term, text }: { term: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        aria-label={`Explain ${term}`}
        aria-expanded={open}
        className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded text-slate-500 hover:text-[#0B2545] focus-visible:outline-2 focus-visible:outline-[#13A3A3]"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-30 left-0 top-6 w-72 p-3 bg-white border border-slate-200 rounded-lg shadow-md text-xs text-slate-700 font-normal leading-relaxed"
        >
          <strong className="block text-[#0B2545] mb-1">{term}</strong>
          {text}
        </span>
      )}
    </span>
  );
}

export function StageReadinessChart({
  stages,
  threshold,
}: {
  stages: StageSummary[];
  threshold: number;
}) {
  const width = 560;
  const height = 220;
  const barWidth = 56;
  const gap = 28;
  const startX = 48;
  const chartBottom = 175;
  const chartHeight = 140;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="Bar chart of readiness score per lifecycle stage"
      >
        <title>Stage readiness scores across the 6 AI lifecycle stages</title>
        {/* Threshold line */}
        <line
          x1={startX - 10}
          y1={chartBottom - threshold * chartHeight}
          x2={width - 16}
          y2={chartBottom - threshold * chartHeight}
          stroke="#13A3A3"
          strokeDasharray="4 4"
          strokeWidth="1.5"
        />
        <text
          x={width - 18}
          y={chartBottom - threshold * chartHeight - 5}
          textAnchor="end"
          className="text-[10px] fill-teal-700 font-mono"
        >
          Threshold {(threshold * 100).toFixed(0)}%
        </text>

        {/* Baseline axis */}
        <line x1={startX - 10} y1={chartBottom} x2={width - 16} y2={chartBottom} stroke="#CBD5E1" strokeWidth="1" />

        {stages.map((s, idx) => {
          const x = startX + idx * (barWidth + gap);
          const barH = Math.max(4, s.rs * chartHeight);
          const y = chartBottom - barH;
          const fill =
            s.gs === 1 ? '#0B2545' : s.effectiveGs === 1 ? '#13A3A3' : '#D97706';

          return (
            <g key={s.stage}>
              <rect x={x} y={y} width={barWidth} height={barH} rx={4} fill={fill} />
              <text
                x={x + barWidth / 2}
                y={y - 6}
                textAnchor="middle"
                className="text-[11px] font-mono fill-slate-800"
              >
                {(s.rs * 100).toFixed(0)}%
              </text>
              <text
                x={x + barWidth / 2}
                y={chartBottom + 16}
                textAnchor="middle"
                className="text-[11px] fill-slate-700 font-medium"
              >
                Stage {s.stage}
              </text>
              <text
                x={x + barWidth / 2}
                y={chartBottom + 30}
                textAnchor="middle"
                className="text-[10px] fill-slate-500"
              >
                Gs={s.gs}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-sm text-slate-600 mt-2">
        Chart summary: {stages.filter((s) => s.gs === 1).length} of 6 stages pass all blocking gates.
        {' '}
        {stages
          .filter((s) => s.scoreHighButGateLocked)
          .map((s) => `Stage ${s.stage} (${s.name}) has a high score but is gate-locked.`)
          .join(' ')}
      </p>
    </div>
  );
}

export function RiskDistributionChart({ risks }: { risks: RiskSummary[] }) {
  const counts = {
    Mitigated: risks.filter((r) => r.status === 'Mitigated').length,
    Excepted: risks.filter((r) => r.status === 'Excepted').length,
    'Formally Accepted': risks.filter((r) => r.status === 'Formally Accepted').length,
    'In remediation': risks.filter((r) => r.status === 'In remediation').length,
    Open: risks.filter((r) => r.status === 'Open').length,
  };
  const entries = Object.entries(counts);
  const maxVal = Math.max(1, ...entries.map((e) => e[1]));
  const colors: Record<string, string> = {
    Mitigated: '#16A34A',
    Excepted: '#13A3A3',
    'Formally Accepted': '#0B2545',
    'In remediation': '#D97706',
    Open: '#DC2626',
  };

  return (
    <div>
      <svg
        viewBox="0 0 520 185"
        className="w-full h-auto"
        role="img"
        aria-label="Horizontal bar chart of governance risk statuses"
      >
        <title>Distribution of governance risks by status</title>
        {entries.map(([label, val], idx) => {
          const y = 16 + idx * 32;
          const barW = (val / maxVal) * 260;
          return (
            <g key={label}>
              <text x={12} y={y + 16} className="text-[12px] fill-slate-700 font-medium">
                {label}
              </text>
              <rect x={165} y={y + 3} width={Math.max(4, barW)} height={18} rx={3} fill={colors[label]} />
              <text x={165 + Math.max(4, barW) + 8} y={y + 16} className="text-[12px] font-mono fill-slate-800">
                {val}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-sm text-slate-600 mt-1">
        Chart summary: {counts.Mitigated} mitigated, {counts.Open + counts['In remediation']} open or in remediation, {counts.Excepted} excepted, and {counts['Formally Accepted']} formally accepted.
      </p>
    </div>
  );
}
