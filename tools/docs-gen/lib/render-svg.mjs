// render-svg.mjs — hand-authored inline SVG diagrams, themed via CSS vars / classes.
// All diagrams use the .dg-* classes defined in assets/style.css so they read in
// both light and dark mode. No external libraries; layout is computed here.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ----- shared marker defs (arrowheads) -----
function markerDefs() {
  return `<defs>
      <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="dg-fill-line"/></marker>
      <marker id="arrc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="dg-fill-accent"/></marker>
    </defs>`;
}

// =====================================================================
// 1. Cycle dependency DAG — layered left→right by longest-path depth.
// =====================================================================
export function renderDag(meta) {
  const cycles = meta.cycles;
  const ids = cycles.map((c) => c.id);
  const depMap = new Map(cycles.map((c) => [c.id, (c.deps || []).filter((d) => ids.includes(d))]));
  const crit = new Set(meta.criticalPath || []);
  const critEdges = critEdgeSet(meta.criticalPath || []);

  // longest-path depth = column
  const depth = new Map();
  const computeDepth = (id, seen = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const ds = depMap.get(id) || [];
    const d = ds.length === 0 ? 0 : 1 + Math.max(...ds.map((x) => computeDepth(x, seen)));
    depth.set(id, d);
    return d;
  };
  ids.forEach((id) => computeDepth(id));

  // group by column, order rows within a column stably by id
  const cols = new Map();
  ids.forEach((id) => {
    const d = depth.get(id);
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d).push(id);
  });
  const maxDepth = Math.max(...depth.values());

  // geometry
  const NW = 132, NH = 50, COLGAP = 78, ROWGAP = 20;
  const colX = (d) => 20 + d * (NW + COLGAP);
  const maxRows = Math.max(...[...cols.values()].map((a) => a.length));
  const W = colX(maxDepth) + NW + 20;
  const H = 60 + maxRows * (NH + ROWGAP) + 20;

  const pos = new Map();
  for (const [d, list] of cols) {
    const colH = list.length * (NH + ROWGAP) - ROWGAP;
    const top = 50 + (H - 70 - colH) / 2;
    list.forEach((id, i) => pos.set(id, { x: colX(d), y: top + i * (NH + ROWGAP) }));
  }

  // edges
  let edges = '';
  for (const c of cycles) {
    for (const dep of depMap.get(c.id) || []) {
      const a = pos.get(dep), b = pos.get(c.id);
      if (!a || !b) continue;
      const x1 = a.x + NW, y1 = a.y + NH / 2;
      const x2 = b.x, y2 = b.y + NH / 2;
      const isCrit = critEdges.has(`${dep}>${c.id}`);
      const mx = (x1 + x2) / 2;
      const d = `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      edges += `<path d="${d}" fill="none" class="${isCrit ? 'dg-edge-crit' : 'dg-edge'}" stroke-width="${isCrit ? 2.5 : 1.6}" marker-end="url(#${isCrit ? 'arrc' : 'arr'})"/>`;
    }
  }

  // nodes
  const titleById = new Map(cycles.map((c) => [c.id, c.title]));
  let nodes = '';
  for (const id of ids) {
    const p = pos.get(id);
    const isCrit = crit.has(id);
    const label = shortTitle(titleById.get(id));
    nodes += `<g>
        <rect x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="11" class="${isCrit ? 'dg-node-crit' : 'dg-node-fill dg-node-stroke'}" stroke-width="${isCrit ? 2 : 1.5}"/>
        <text x="${p.x + NW / 2}" y="${p.y + 21}" text-anchor="middle" class="dg-text" font-weight="700" font-size="12.5">${esc(id)}</text>
        <text x="${p.x + NW / 2}" y="${p.y + 37}" text-anchor="middle" class="dg-subtext" font-size="9.5">${esc(label)}</text>
      </g>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="dag-t dag-d" font-size="13">
    <title id="dag-t">Plan-${meta.id} cycle dependency graph</title>
    <desc id="dag-d">Cycles laid out left to right by dependency depth. The critical path (${esc((meta.criticalPath || []).join(' → '))}) is highlighted.</desc>
    ${markerDefs()}
    ${edges}
    ${nodes}
  </svg>`;
}

// =====================================================================
// 2. Batch / critical-path timeline — one column per batch, lanes inside.
// =====================================================================
export function renderTimeline(meta) {
  const batches = meta.batches || [];
  const crit = new Set(meta.criticalPath || []);
  const titleById = new Map(meta.cycles.map((c) => [c.id, c.title]));

  const COLW = 220, COLGAP = 30, ROWH = 38, ROWGAP = 10, HEADH = 64;
  const maxLanes = Math.max(1, ...batches.map((b) => b.cycles.length));
  const W = batches.length * COLW + (batches.length - 1) * COLGAP + 40;
  const H = HEADH + maxLanes * (ROWH + ROWGAP) + 44;
  const colX = (i) => 20 + i * (COLW + COLGAP);

  let svg = '';
  // separators
  for (let i = 1; i < batches.length; i++) {
    const x = colX(i) - COLGAP / 2;
    svg += `<line x1="${x}" y1="${HEADH}" x2="${x}" y2="${H - 36}" class="dg-grid" stroke-width="1" stroke-dasharray="3 5"/>`;
  }
  // columns
  batches.forEach((b, i) => {
    const x = colX(i);
    const par = b.cycles.length > 1 ? `${b.cycles.length} parallel` : 'solo';
    svg += `<text x="${x + COLW / 2}" y="30" text-anchor="middle" class="dg-text" font-family="var(--serif)" font-weight="700" font-size="15">${esc(b.id)}</text>`;
    svg += `<text x="${x + COLW / 2}" y="48" text-anchor="middle" class="dg-subtext" font-size="10">${esc(b.wallTime || '')} · ${par}</text>`;
    // lanes
    const laneTop = HEADH + (maxLanes - b.cycles.length) * (ROWH + ROWGAP) / 2;
    b.cycles.forEach((cid, j) => {
      const y = laneTop + j * (ROWH + ROWGAP);
      const isCrit = crit.has(cid);
      svg += `<g>
          <rect x="${x}" y="${y}" width="${COLW}" height="${ROWH}" rx="8" class="${isCrit ? 'dg-node-crit' : 'dg-node-fill dg-node-stroke'}" stroke-width="${isCrit ? 2 : 1.5}"/>
          <text x="${x + 16}" y="${y + ROWH / 2 + 4}" class="dg-text" font-weight="700" font-size="12">${esc(cid)}</text>
          <text x="${x + COLW - 14}" y="${y + ROWH / 2 + 4}" text-anchor="end" class="dg-subtext" font-size="10">${esc(shortTitle(titleById.get(cid)))}</text>
        </g>`;
    });
  });

  // critical-path arrows between adjacent batches (connect the crit cycle in each)
  for (let i = 0; i + 1 < batches.length; i++) {
    const a = batches[i].cycles.find((c) => crit.has(c));
    const b = batches[i + 1].cycles.find((c) => crit.has(c));
    if (!a || !b) continue;
    const x1 = colX(i) + COLW, x2 = colX(i + 1);
    const yMid = HEADH + maxLanes * (ROWH + ROWGAP) / 2;
    svg += `<path d="M${x1} ${yMid} C ${(x1 + x2) / 2} ${yMid}, ${(x1 + x2) / 2} ${yMid}, ${x2} ${yMid}" fill="none" class="dg-edge-crit" stroke-width="2.5" marker-end="url(#arrc)"/>`;
  }

  svg += `<text x="${W / 2}" y="${H - 12}" text-anchor="middle" class="dg-fill-accent" font-family="var(--mono)" font-size="11" font-weight="700">critical path · ${esc((meta.criticalPath || []).join(' → '))}</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="tl-t tl-d" font-size="13">
    <title id="tl-t">Plan-${meta.id} batch timeline</title>
    <desc id="tl-d">${batches.length} batches over time; cycles within a batch run in parallel. Critical path: ${esc((meta.criticalPath || []).join(' → '))}.</desc>
    ${markerDefs()}
    ${svg}
  </svg>`;
}

// =====================================================================
// 3. Static TDD loop — identical for every plan.
// =====================================================================
export function renderTddLoop() {
  return `<svg viewBox="0 0 880 280" role="img" aria-labelledby="loop-t loop-d" font-size="13">
    <title id="loop-t">TDD cycle loop</title>
    <desc id="loop-d">RED flows to GREEN to REVIEW. From REVIEW, APPROVED flows forward to COMMIT; NEEDS FIX flows down to REFACTOR, which loops back up to REVIEW.</desc>
    <defs>
      <marker id="la" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="dg-fill-line"/></marker>
      <marker id="lac" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="dg-fill-accent"/></marker>
    </defs>
    <g><rect x="20" y="96" width="140" height="56" rx="12" fill="var(--surface-2)" stroke="var(--red)" stroke-width="2"/><text x="90" y="124" text-anchor="middle" fill="var(--red)" font-family="var(--mono)" font-weight="700">RED</text><text x="90" y="142" text-anchor="middle" class="dg-subtext" font-size="9.5">failing test</text></g>
    <g><rect x="230" y="96" width="140" height="56" rx="12" fill="var(--surface-2)" stroke="var(--green)" stroke-width="2"/><text x="300" y="124" text-anchor="middle" fill="var(--green)" font-family="var(--mono)" font-weight="700">GREEN</text><text x="300" y="142" text-anchor="middle" class="dg-subtext" font-size="9.5">minimal pass</text></g>
    <g><rect x="440" y="92" width="150" height="64" rx="12" fill="var(--surface-2)" stroke="var(--review)" stroke-width="2.5"/><text x="515" y="120" text-anchor="middle" fill="var(--review)" font-family="var(--mono)" font-weight="700">REVIEW</text><text x="515" y="138" text-anchor="middle" class="dg-subtext" font-size="9.5">the gate</text></g>
    <g><rect x="720" y="96" width="140" height="56" rx="12" class="dg-node-crit" stroke-width="2"/><text x="790" y="124" text-anchor="middle" class="dg-fill-accent" font-family="var(--mono)" font-weight="700">COMMIT</text><text x="790" y="142" text-anchor="middle" class="dg-subtext" font-size="9.5">one per cycle</text></g>
    <g><rect x="440" y="210" width="150" height="52" rx="12" fill="var(--surface-2)" stroke="var(--refactor)" stroke-width="2"/><text x="515" y="234" text-anchor="middle" fill="var(--refactor)" font-family="var(--mono)" font-weight="700">REFACTOR</text><text x="515" y="251" text-anchor="middle" class="dg-subtext" font-size="9.5">apply review</text></g>
    <path d="M160 124 H226" fill="none" class="dg-edge" stroke-width="2" marker-end="url(#la)"/>
    <path d="M370 124 H436" fill="none" class="dg-edge" stroke-width="2" marker-end="url(#la)"/>
    <path d="M590 124 H716" fill="none" class="dg-edge-crit" stroke-width="2.5" marker-end="url(#lac)"/>
    <text x="650" y="114" text-anchor="middle" class="dg-fill-accent" font-family="var(--mono)" font-size="10.5" font-weight="700">APPROVED</text>
    <path d="M515 156 V206" fill="none" class="dg-edge" stroke-width="2" marker-end="url(#la)"/>
    <text x="525" y="186" class="dg-subtext" font-size="10.5" fill="var(--refactor)">NEEDS FIX</text>
    <path d="M440 236 C 380 236, 380 124, 436 124" fill="none" class="dg-edge" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#la)"/>
    <text x="372" y="186" text-anchor="middle" class="dg-subtext" font-size="10" transform="rotate(-90 372 186)">loop until APPROVED</text>
  </svg>`;
}

// =====================================================================
// helpers
// =====================================================================
function critEdgeSet(path) {
  const s = new Set();
  for (let i = 0; i + 1 < path.length; i++) s.add(`${path[i]}>${path[i + 1]}`);
  return s;
}

// Trim a cycle title to fit a node label. Drops trailing parentheticals + truncates.
function shortTitle(t) {
  if (!t) return '';
  let s = t.replace(/\(.*?\)/g, '').replace(/[—-]\s*\d+\.\d+.*/, '').trim();
  s = s.replace(/`/g, '');
  if (s.length > 22) s = s.slice(0, 21).trimEnd() + '…';
  return s;
}
