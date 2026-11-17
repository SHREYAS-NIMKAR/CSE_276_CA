import React, { useMemo, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { apiRequest } from '../api';
import { AssessmentResult, KnowledgeGraphData, ProjectItem } from '../types';
import { DemoTag } from './UiPrimitives';

interface GraphNode {
  id: string;
  kind: 'stage' | 'artefact' | 'risk' | 'govreq';
  label: string;
  subtitle: string;
  stage: number;
  x: number;
  y: number;
  statusColor?: string;
  statusText?: string;
  meta: Record<string, unknown>;
}

interface GraphEdge {
  from: string;
  to: string;
  relation: string;
}

export function KnowledgeGraphView({
  knowledge,
  projects,
  selectedProjectId,
  onSelectProject,
  selectedAssessment,
}: {
  knowledge: KnowledgeGraphData;
  projects: ProjectItem[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  selectedAssessment: AssessmentResult | null;
}) {
  const [stageFilter, setStageFilter] = useState<number>(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [jsonLdText, setJsonLdText] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const evidenceStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    if (selectedAssessment) {
      for (const st of selectedAssessment.stageSummaries) {
        for (const a of st.artefactDetails) {
          map.set(a.artefactId, a.classification);
        }
      }
    }
    return map;
  }, [selectedAssessment]);

  const { nodes, edges } = useMemo(() => {
    const outNodes: GraphNode[] = [];
    const outEdges: GraphEdge[] = [];

    const filteredStages =
      stageFilter === 0
        ? knowledge.stages
        : knowledge.stages.filter((s) => s.stage === stageFilter);

    const visibleStageNums = new Set(filteredStages.map((s) => s.stage));

    const visibleArts = knowledge.artefacts.filter((a) => visibleStageNums.has(a.stage));
    const visibleRisks = knowledge.risks.filter((r) => visibleStageNums.has(r.stage));
    const visibleGovReqs = knowledge.governanceRequirements.filter((g) =>
      visibleStageNums.has(g.stage)
    );

    const colX = { stage: 100, artefact: 345, risk: 635, govreq: 950 };

    // Place Stage nodes
    const stageSpacing = Math.max(95, 580 / Math.max(1, filteredStages.length));
    filteredStages.forEach((st, idx) => {
      outNodes.push({
        id: `stage:${st.stage}`,
        kind: 'stage',
        label: `Stage ${st.stage}: ${st.name}`,
        subtitle: st.focus,
        stage: st.stage,
        x: colX.stage,
        y: 55 + idx * stageSpacing,
        meta: { ...st },
      });
    });

    // Place Artefact nodes
    const artSpacing = Math.max(36, 620 / Math.max(1, visibleArts.length));
    visibleArts.forEach((a, idx) => {
      const evStatus = evidenceStatusMap.get(a.id) ?? 'Not selected';
      let fill = '#F1F5F9';
      if (evStatus === 'Verified') fill = '#D1FAE5';
      else if (evStatus === 'Submitted but unverified') fill = '#FEF3C7';
      else if (evStatus === 'Unclear') fill = '#FFEDD5';
      else if (evStatus === 'Expired' || evStatus === 'Not submitted') fill = '#FFE4E6';

      outNodes.push({
        id: `artefact:${a.id}`,
        kind: 'artefact',
        label: a.name,
        subtitle: `Weight ${(a.weight * 100).toFixed(0)}%${a.isBlocking ? ' · Blocking' : ''}`,
        stage: a.stage,
        x: colX.artefact,
        y: 38 + idx * artSpacing,
        statusColor: fill,
        statusText: evStatus,
        meta: { ...a },
      });
      outEdges.push({ from: `stage:${a.stage}`, to: `artefact:${a.id}`, relation: 'requires' });
      for (const rId of a.reducesRisks) {
        outEdges.push({ from: `artefact:${a.id}`, to: `risk:${rId}`, relation: 'reduces' });
      }
    });

    // Place Risk nodes
    const riskSpacing = Math.max(40, 620 / Math.max(1, visibleRisks.length));
    visibleRisks.forEach((r, idx) => {
      outNodes.push({
        id: `risk:${r.id}`,
        kind: 'risk',
        label: r.name,
        subtitle: `${r.severity} severity`,
        stage: r.stage,
        x: colX.risk,
        y: 42 + idx * riskSpacing,
        meta: { ...r },
      });
      outEdges.push({
        from: `risk:${r.id}`,
        to: `govreq:${r.linkedGovernanceRequirement}`,
        relation: 'violates',
      });
    });

    // Place GovReq nodes
    const govSpacing = Math.max(95, 580 / Math.max(1, visibleGovReqs.length));
    visibleGovReqs.forEach((g, idx) => {
      outNodes.push({
        id: `govreq:${g.id}`,
        kind: 'govreq',
        label: g.title,
        subtitle: g.id,
        stage: g.stage,
        x: colX.govreq,
        y: 55 + idx * govSpacing,
        meta: { ...g },
      });
    });

    return { nodes: outNodes, edges: outEdges };
  }, [knowledge, stageFilter, evidenceStatusMap]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const connectedSet = useMemo(() => {
    if (!selectedNodeId) return null;
    const set = new Set<string>([selectedNodeId]);
    for (const e of edges) {
      if (e.from === selectedNodeId) set.add(e.to);
      if (e.to === selectedNodeId) set.add(e.from);
    }
    return set;
  }, [selectedNodeId, edges]);

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;

  const maxSvgHeight = Math.max(520, ...nodes.map((n) => n.y + 55));

  async function handleLoadJsonLd() {
    if (!selectedProjectId) return;
    const data = await apiRequest<Record<string, unknown>>(`/projects/${selectedProjectId}/jsonld`);
    setJsonLdText(JSON.stringify(data, null, 2));
  }

  function handleCopyJsonLd() {
    if (!jsonLdText) return;
    navigator.clipboard?.writeText(jsonLdText);
    setCopyMsg('Copied to clipboard');
    setTimeout(() => setCopyMsg(null), 2000);
  }

  function handleDownloadJsonLd() {
    if (!jsonLdText) return;
    const blob = new Blob([jsonLdText], { type: 'application/ld+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `knowledge-graph-${selectedProjectId}.jsonld`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0B2545]">
            Lifecycle Knowledge Graph &amp; Ontology
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Click any node to highlight connected lifecycle stages, artefacts, risks, and governance requirements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="kg-stage-filter" className="sr-only">
              Filter by stage
            </label>
            <select
              id="kg-stage-filter"
              value={stageFilter}
              onChange={(e) => {
                setStageFilter(Number(e.target.value));
                setSelectedNodeId(null);
              }}
              className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
            >
              <option value={0}>All 6 Stages</option>
              {knowledge.stages.map((s) => (
                <option key={s.stage} value={s.stage}>
                  Stage {s.stage}: {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="kg-project-select" className="sr-only">
              Overlay project status
            </label>
            <select
              id="kg-project-select"
              value={selectedProjectId}
              onChange={(e) => onSelectProject(e.target.value)}
              className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  Overlay: {p.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleLoadJsonLd}
            className="px-4 py-2 bg-[#0B2545] text-white text-sm font-medium rounded-lg hover:bg-[#133863] cursor-pointer"
          >
            Export JSON-LD
          </button>
        </div>
      </div>

      {/* Shape & Evidence Status Legend */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-700">
        <div className="flex flex-wrap items-center gap-5">
          <span className="font-semibold text-[#0B2545]">Node shapes:</span>
          <span>[Rounded Double Box] Stage</span>
          <span>[Rectangle] Artefact</span>
          <span>&lt;Diamond&gt; Risk</span>
          <span>(Hexagon) Governance Requirement</span>
        </div>
        {selectedProject && (
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold text-[#0B2545]">
              Artefact status ({selectedProject.name} <DemoTag isDemo={selectedProject.is_demo} />):
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-3 inline-block rounded border border-emerald-500 bg-emerald-100" /> ✔ Verified
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-3 inline-block rounded border border-amber-500 bg-amber-100" /> ⚠ Submitted
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-3 inline-block rounded border border-orange-500 bg-orange-100" /> ⚠ Unclear
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-3 inline-block rounded border border-rose-500 bg-rose-100" /> ✖ Missing/Expired
            </span>
          </div>
        )}
      </div>

      {/* JSON-LD Export Panel (shown immediately above graph when exported) */}
      {jsonLdText && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-base font-bold text-[#0B2545]">
              Project Knowledge Graph (JSON-LD)
            </h2>
            <div className="flex items-center gap-2">
              {copyMsg && <span className="text-xs text-emerald-700 font-medium">{copyMsg}</span>}
              <button
                type="button"
                onClick={handleCopyJsonLd}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium hover:bg-slate-50 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
              <button
                type="button"
                onClick={handleDownloadJsonLd}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0B2545] text-white rounded-lg text-xs font-medium hover:bg-[#133863] cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Download .jsonld
              </button>
              <button
                type="button"
                onClick={() => setJsonLdText(null)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg text-xs overflow-x-auto max-h-72">
            {jsonLdText}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 overflow-x-auto">
          <svg
            viewBox={`0 0 1100 ${maxSvgHeight}`}
            className="w-full min-w-[840px] h-auto"
            role="img"
            aria-label="Interactive AI governance lifecycle knowledge graph"
          >
            <title>Knowledge graph linking stages, artefacts, risks, and governance requirements</title>

            {/* Column headers */}
            <text x={100} y={18} textAnchor="middle" className="text-[11px] font-bold fill-slate-500">
              STAGE (Double Box)
            </text>
            <text x={345} y={18} textAnchor="middle" className="text-[11px] font-bold fill-slate-500">
              ARTEFACT (Rectangle)
            </text>
            <text x={635} y={18} textAnchor="middle" className="text-[11px] font-bold fill-slate-500">
              RISK (Diamond)
            </text>
            <text x={950} y={18} textAnchor="middle" className="text-[11px] font-bold fill-slate-500">
              REQUIREMENT (Hexagon)
            </text>

            {/* Edges */}
            {edges.map((e, idx) => {
              const fromNode = nodeMap.get(e.from);
              const toNode = nodeMap.get(e.to);
              if (!fromNode || !toNode) return null;
              const isHighlighted =
                !connectedSet || (connectedSet.has(e.from) && connectedSet.has(e.to));
              return (
                <line
                  key={`${e.from}-${e.to}-${idx}`}
                  x1={fromNode.x + 65}
                  y1={fromNode.y}
                  x2={toNode.x - 65}
                  y2={toNode.y}
                  stroke={
                    selectedNodeId && isHighlighted ? '#13A3A3' : '#CBD5E1'
                  }
                  strokeWidth={selectedNodeId && isHighlighted ? 2 : 1}
                  strokeOpacity={isHighlighted ? 0.9 : 0.15}
                />
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              const active = !connectedSet || connectedSet.has(node.id);
              const isSelected = selectedNodeId === node.id;
              const opacity = active ? 1 : 0.22;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() =>
                    setSelectedNodeId((prev) => (prev === node.id ? null : node.id))
                  }
                  className="cursor-pointer"
                  opacity={opacity}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.kind}: ${node.label}`}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
                    }
                  }}
                >
                  <title>{node.label}</title>
                  {node.kind === 'stage' && (
                    <>
                      <rect
                        x={-84}
                        y={-22}
                        width={168}
                        height={44}
                        rx={8}
                        fill="#0B2545"
                        stroke={isSelected ? '#13A3A3' : '#0B2545'}
                        strokeWidth={isSelected ? 3 : 1.5}
                      />
                      <rect
                        x={-80}
                        y={-18}
                        width={160}
                        height={36}
                        rx={5}
                        fill="none"
                        stroke="#94A3B8"
                        strokeWidth={0.8}
                      />
                      <text y={-2} textAnchor="middle" className="text-[10px] font-semibold fill-white">
                        [Stage {node.stage}]
                      </text>
                      <text y={11} textAnchor="middle" className="text-[10px] fill-teal-200">
                        {node.label.replace(`Stage ${node.stage}: `, '').slice(0, 24)}
                      </text>
                    </>
                  )}

                  {node.kind === 'artefact' && (
                    <>
                      <rect
                        x={-90}
                        y={-15}
                        width={180}
                        height={30}
                        rx={3}
                        fill={node.statusColor ?? '#F8FAFC'}
                        stroke={isSelected ? '#0B2545' : '#64748B'}
                        strokeWidth={isSelected ? 2.5 : 1}
                      />
                      <text y={-1} textAnchor="middle" className="text-[10px] font-medium fill-slate-900">
                        {node.label.length > 26 ? `${node.label.slice(0, 24)}…` : node.label}
                      </text>
                      <text y={10} textAnchor="middle" className="text-[8.5px] fill-slate-600">
                        [Artefact] {node.statusText}
                      </text>
                    </>
                  )}

                  {node.kind === 'risk' && (
                    <>
                      <polygon
                        points="0,-20 105,0 0,20 -105,0"
                        fill="#FFFBEB"
                        stroke={isSelected ? '#0B2545' : '#D97706'}
                        strokeWidth={isSelected ? 2.5 : 1.2}
                      />
                      <text y={-1} textAnchor="middle" className="text-[9.5px] font-semibold fill-slate-900">
                        {node.label.length > 24 ? `${node.label.slice(0, 22)}…` : node.label}
                      </text>
                      <text y={9} textAnchor="middle" className="text-[8px] fill-amber-800">
                        &lt;Risk · {String(node.meta.severity)}&gt;
                      </text>
                    </>
                  )}

                  {node.kind === 'govreq' && (
                    <>
                      <polygon
                        points="-90,-17 90,-17 104,0 90,17 -90,17 -104,0"
                        fill="#F0FDFA"
                        stroke={isSelected ? '#0B2545' : '#13A3A3'}
                        strokeWidth={isSelected ? 2.5 : 1.2}
                      />
                      <text y={-1} textAnchor="middle" className="text-[9.5px] font-semibold fill-[#0B2545]">
                        {node.label.length > 27 ? `${node.label.slice(0, 25)}…` : node.label}
                      </text>
                      <text y={10} textAnchor="middle" className="text-[8px] fill-teal-800">
                        ({node.subtitle})
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Node Inspector + Stage Details */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-lg font-bold text-[#0B2545]">Node Inspector</h2>
          {!selectedNode ? (
            <div className="text-sm text-slate-600 space-y-2">
              <p>Select any stage, artefact, risk, or governance requirement node on the graph to view its links and acceptance criteria.</p>
              <button
                type="button"
                onClick={() => setSelectedNodeId('stage:1')}
                className="text-sm font-medium text-[#13A3A3] hover:underline cursor-pointer"
              >
                Inspect Stage 1: Data Governance
              </button>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="text-xs font-mono text-slate-500 uppercase">
                {selectedNode.kind} · Stage {selectedNode.stage}
              </div>
              <h3 className="text-base font-bold text-[#0B2545]">{selectedNode.label}</h3>
              <p className="text-slate-600">{selectedNode.subtitle}</p>
              {selectedNode.statusText && (
                <p className="font-medium text-slate-800">
                  Selected project status: {selectedNode.statusText}
                </p>
              )}
              {typeof selectedNode.meta.whyItMatters === 'string' && (
                <p className="text-slate-700">{selectedNode.meta.whyItMatters}</p>
              )}
              {typeof selectedNode.meta.acceptanceCriteria === 'string' && (
                <p className="text-slate-700">
                  <strong>Acceptance:</strong> {selectedNode.meta.acceptanceCriteria}
                </p>
              )}
              {typeof selectedNode.meta.description === 'string' && (
                <p className="text-slate-700">{selectedNode.meta.description}</p>
              )}
              {selectedNode.kind === 'risk' && (
                <p className="text-xs text-slate-600">
                  Policy-acceptable:{' '}
                  <strong>{selectedNode.meta.acceptableUnderPolicy ? 'Yes (RAA only)' : 'No (cannot be accepted)'}</strong>
                </p>
              )}
              <div className="pt-2 border-t border-slate-200">
                <div className="text-xs font-semibold text-slate-500 mb-1">
                  Connected nodes ({(connectedSet?.size ?? 1) - 1})
                </div>
                <ul className="space-y-1 text-xs text-slate-700">
                  {Array.from(connectedSet ?? [])
                    .filter((cid) => cid !== selectedNode.id)
                    .map((cid) => (
                      <li key={cid}>
                        <button
                          type="button"
                          onClick={() => setSelectedNodeId(cid)}
                          className="text-[#0B2545] hover:text-[#13A3A3] underline cursor-pointer text-left"
                        >
                          {nodeMap.get(cid)?.label ?? cid}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
