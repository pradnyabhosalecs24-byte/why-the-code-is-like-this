import { useEffect, useMemo, useRef, useState } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY } from 'd3-force';
import { api, fmtDate, LABEL_COLORS } from '../lib/api.js';
import { Notice, Spinner, ExtLink, LabelTag, StatusBadge } from './ui.jsx';

const W = 900;
const H = 600;

export default function GraphView({ repo, seed, onSeed }) {
  const [graph, setGraph] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);

  // load: answer subgraph, a node neighbourhood, or the decision overview
  useEffect(() => {
    let live = true;
    setError(null);
    setSelected(null);
    if (seed?.kind === 'answer') {
      setGraph(seed.graph);
      return;
    }
    setGraph(null);
    api
      .graph(repo, seed?.kind === 'node' ? seed.id : null)
      .then((g) => {
        if (!live) return;
        setGraph(g);
        if (seed?.kind === 'node') setSelected(seed.id);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [repo, seed]);

  useEffect(() => {
    if (!selected) return setDetail(null);
    let live = true;
    api.node(repo, selected).then((d) => live && setDetail(d.node)).catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [repo, selected]);

  const expand = async (id) => {
    try {
      const g = await api.graph(repo, id);
      setGraph((cur) => merge(cur, g));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="graph-wrap">
      <div className="row between toolbar">
        <span className="small muted">
          {seed?.kind === 'answer' ? <>Evidence graph for “{seed.title}”</> : seed?.kind === 'node' ? 'Neighbourhood of the selected record' : 'Overview: recent decisions and what they link to'}
        </span>
        <span className="row">
          {seed && <button className="btn btn-ghost small" onClick={() => onSeed(null)}>Show overview</button>}
        </span>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {!graph && !error && <Spinner label="Loading graph" />}
      {graph && graph.nodes.length === 0 && <p className="muted">No graph data to show. Decisions appear here after an import finds them.</p>}
      {graph && graph.nodes.length > 0 && (
        <div className="graph-grid">
          <ForceGraph graph={graph} selected={selected} onSelect={setSelected} onExpand={expand} />
          <aside className="card inspector">
            {!detail ? (
              <p className="small muted">Click a node to inspect it. Double-click to expand its neighbours. Dashed edges are inferred from text; solid edges come from GitHub's structured data.</p>
            ) : (
              <NodeDetail node={detail} onExpand={() => expand(detail.id)} />
            )}
            <Legend />
          </aside>
        </div>
      )}
    </div>
  );
}

function merge(a, b) {
  if (!a) return b;
  const nodes = new Map(a.nodes.map((n) => [n.id, n]));
  b.nodes.forEach((n) => nodes.set(n.id, n));
  const key = (r) => `${r.type}|${r.from}|${r.to}`;
  const rels = new Map(a.rels.map((r) => [key(r), r]));
  b.rels.forEach((r) => rels.set(key(r), r));
  return { nodes: [...nodes.values()], rels: [...rels.values()] };
}

function ForceGraph({ graph, selected, onSelect, onExpand }) {
  const [, setTick] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const simRef = useRef(null);
  const dataRef = useRef({ nodes: [], links: [] });
  const drag = useRef(null);
  const svgRef = useRef(null);

  const data = useMemo(() => {
    const prev = new Map(dataRef.current.nodes.map((n) => [n.id, n]));
    const nodes = graph.nodes.map((n) => ({ ...n, x: prev.get(n.id)?.x, y: prev.get(n.id)?.y }));
    const ids = new Set(nodes.map((n) => n.id));
    const links = graph.rels.filter((r) => ids.has(r.from) && ids.has(r.to)).map((r) => ({ ...r, source: r.from, target: r.to }));
    return { nodes, links };
  }, [graph]);

  useEffect(() => {
    dataRef.current = data;
    simRef.current?.stop();
    const sim = forceSimulation(data.nodes)
      .force('link', forceLink(data.links).id((d) => d.id).distance(70).strength(0.6))
      .force('charge', forceManyBody().strength(-160).distanceMax(260))
      .force('center', forceCenter(W / 2, H / 2))
      .force('collide', forceCollide(16))
      .force('x', forceX(W / 2).strength(0.06))
      .force('y', forceY(H / 2).strength(0.09))
      .alphaDecay(0.04)
      .on('tick', () => setTick((t) => t + 1));
    simRef.current = sim;
    return () => sim.stop();
  }, [data]);

  const toGraph = (evt) => {
    const rect = svgRef.current.getBoundingClientRect();
    const sx = ((evt.clientX - rect.left) / rect.width) * W;
    const sy = ((evt.clientY - rect.top) / rect.height) * H;
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  };

  const onPointerMove = (e) => {
    if (!drag.current) return;
    if (drag.current.node) {
      const p = toGraph(e);
      drag.current.node.fx = p.x;
      drag.current.node.fy = p.y;
      simRef.current.alphaTarget(0.2).restart();
    } else {
      const rect = svgRef.current.getBoundingClientRect();
      const dx = ((e.clientX - drag.current.cx) / rect.width) * W;
      const dy = ((e.clientY - drag.current.cy) / rect.height) * H;
      setView((v) => ({ ...v, x: drag.current.vx + dx, y: drag.current.vy + dy }));
    }
  };
  const endDrag = () => {
    if (drag.current?.node) {
      drag.current.node.fx = null;
      drag.current.node.fy = null;
      simRef.current.alphaTarget(0);
    }
    drag.current = null;
  };
  const onWheel = (e) => {
    const k = Math.min(3, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    setView((v) => ({ ...v, k }));
  };

  const neighbours = useMemo(() => {
    const s = new Set();
    if (selected) for (const l of data.links) {
      const a = l.source.id ?? l.source;
      const b = l.target.id ?? l.target;
      if (a === selected) s.add(b);
      if (b === selected) s.add(a);
    }
    return s;
  }, [selected, data]);

  return (
    <svg
      ref={svgRef}
      className="graph"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Knowledge graph"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onWheel={onWheel}
      onPointerDown={(e) => {
        if (e.target === svgRef.current) drag.current = { cx: e.clientX, cy: e.clientY, vx: view.x, vy: view.y };
      }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--border-strong)" />
        </marker>
      </defs>
      <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
        {data.links.map((l, i) => {
          const s = l.source;
          const t = l.target;
          if (s.x == null || t.x == null) return null;
          const hot = selected && (s.id === selected || t.id === selected);
          return (
            <g key={i}>
              <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} className={`edge ${l.origin === 'inferred' ? 'inferred' : ''} ${hot ? 'hot' : ''}`} markerEnd="url(#arrow)" />
              {hot && (
                <text x={(s.x + t.x) / 2} y={(s.y + t.y) / 2} className="edge-label">
                  {l.type}
                </text>
              )}
            </g>
          );
        })}
        {data.nodes.map((n) => {
          if (n.x == null) return null;
          const dim = selected && n.id !== selected && !neighbours.has(n.id);
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              className={`gnode ${n.id === selected ? 'sel' : ''} ${dim ? 'dim' : ''}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                drag.current = { node: n };
                onSelect(n.id);
              }}
              onDoubleClick={() => onExpand(n.id)}
            >
              <circle r={n.label === 'Decision' ? 9 : 7} fill={LABEL_COLORS[n.label] || 'var(--muted)'} stroke={n.status === 'superseded' ? 'var(--amber)' : n.status === 'disputed' ? 'var(--red)' : 'none'} strokeWidth="2.5" />
              <title>{`${n.label}: ${n.name}`}</title>
              {(n.id === selected || neighbours.has(n.id) || data.nodes.length < 30) && (
                <text x="12" y="4" className="node-label">
                  {String(n.name).slice(0, 38)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function NodeDetail({ node, onExpand }) {
  const p = node.props;
  const fields = [
    ['Statement', p.statement], ['Rationale', p.rationale], ['Status', p.statusReason], ['Title', p.title], ['Path', p.path],
    ['Key', p.key], ['Value', p.value], ['Name', p.name], ['Author', p.author], ['Date', p.date && fmtDate(p.date)],
    ['Extraction', p.extractionMethod], ['Kind', p.kind], ['Text', p.text && p.text.slice(0, 500)],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '');
  return (
    <div>
      <div className="row between">
        <LabelTag label={node.label} />
        <StatusBadge status={p.status} />
      </div>
      <dl className="detail">
        {fields.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={k === 'Path' || k === 'Key' ? 'mono' : ''}>{String(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="row">
        <ExtLink href={p.url}>open source record</ExtLink>
        <button className="btn btn-ghost small" onClick={onExpand}>expand neighbours</button>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend small">
      {Object.keys(LABEL_COLORS).filter((l) => !['Repository', 'Module'].includes(l)).map((l) => (
        <LabelTag key={l} label={l} />
      ))}
      <span className="legend-edge"><i className="solid" /> confirmed</span>
      <span className="legend-edge"><i className="dashed" /> inferred</span>
    </div>
  );
}
