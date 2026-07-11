// templates.mjs — page templates extracted from the bespoke plan-002 HTML.
// Produces self-contained, offline, accessible, themed HTML. Asset paths are
// caller-relative ("assets/..." for the root landing, "../assets/..." for plan pages).

import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import { renderDag, renderTimeline, renderTddLoop } from './render-svg.mjs';

// linkify is OFF: source prose contains bare tokens like `AGENTS.md`, `ghcr.io`, and
// CSP host patterns that must NOT become network links in an offline doc set.
const md = new MarkdownIt({ html: false, linkify: false, typographer: true }).use(anchor, {
  permalink: false,
  slugify: (s) => s.toLowerCase().replace(/[^\w]+/g, '-').replace(/(^-|-$)/g, ''),
});

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ---- icons (inline SVG) ----------------------------------------------------
const IC = {
  logo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  moon: '<svg class="moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  sun: '<svg class="sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  burger: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>',
  chevSm: '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>',
  copy: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  user: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  info: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  warn: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  gate: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3"/></svg>',
  eye: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  x: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
};

const PHASE_LABELS = { RED: 'red', GREEN: 'green', REVIEW: 'review', REFACTOR: 'refactor', 'SECURITY-REVIEW': 'review' };

// Neutralise relative links from source prose (they point at repo .md files / rules,
// not at pages in this generated site). Keep the link text; drop the dead href so the
// offline doc set has no broken local links. External http(s) links are left intact
// (there are none in the current sources, but future-proof). Renders as a styled
// <span> carrying the original target in a title for traceability.
const _linkStack = [];
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const href = tokens[idx].attrGet('href') || '';
  const keep = /^https?:\/\//i.test(href) || href.startsWith('#');
  _linkStack.push(keep);
  if (keep) return self.renderToken(tokens, idx, options);
  // relative repo reference → inert <span class="ref"> (keeps label, drops dead href)
  return `<span class="ref" title="source ref: ${esc(href)}">`;
};
md.renderer.rules.link_close = function (tokens, idx, options, env, self) {
  const keep = _linkStack.pop();
  return keep ? self.renderToken(tokens, idx, options) : '</span>';
};

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------
export function pageShell({ site, title, description, assetPrefix, nav, hero, toc, content, footerSource }) {
  const css = `${assetPrefix}assets/style.css`;
  const js = `${assetPrefix}assets/app.js`;
  const layoutClass = toc ? 'layout' : 'layout no-toc';
  // Per-project identity injected per page: theme localStorage key on <html>, accent
  // override as an inline :root rule (shared style.css carries a default). app.js reads
  // the theme key from the DOM attribute, so the shared asset stays project-agnostic.
  const themeKey = (site && site.themeKey) || 'docs-theme';
  const accent = site && site.accent ? site.accent : null;
  const accentStyle = accent ? `\n<style>:root{--accent:${accent}}</style>` : '';
  return `<!DOCTYPE html>
<html lang="en" data-theme="light" data-theme-key="${esc(themeKey)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="stylesheet" href="${css}">${accentStyle}
<script>(function(){try{var k=document.documentElement.getAttribute('data-theme-key')||'docs-theme';var t=localStorage.getItem(k)||((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${topnav(nav, assetPrefix, site)}
${hero || ''}
<main id="main" class="${layoutClass}">
${toc ? tocAside(toc) : ''}
  <div class="content">
${content}
  </div>
</main>
${footer(footerSource, site)}
<script src="${js}"></script>
</body>
</html>
`;
}

function topnav(nav, assetPrefix, site) {
  const brand = (site && site.productName) || 'Docs';
  const links = nav.links
    .map((l) => `      <a class="navlink" href="${l.href}"${l.current ? ' aria-current="page"' : ''}>${esc(l.label)}</a>`)
    .join('\n');
  return `<header class="topnav">
  <div class="topnav-inner">
    <a class="brand" href="${nav.home}" aria-label="${esc(brand)} plan docs home">
      <span class="mark" aria-hidden="true">${IC.logo}</span>
      ${esc(brand)} <span class="tag">${esc(nav.tag || 'docs')}</span>
    </a>
    <nav aria-label="Primary">
${links}
      <button class="theme-toggle" type="button" aria-label="Switch theme" aria-pressed="false">${IC.moon}${IC.sun}</button>
    </nav>
    <button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false">${IC.burger}</button>
  </div>
</header>`;
}

function tocAside(items) {
  const lis = items
    .map((it) => `      <li><a href="#${esc(it.id)}"${it.sub ? ' class="sub"' : ''}>${esc(it.label)}</a></li>`)
    .join('\n');
  return `  <aside class="toc" aria-label="On this page">
    <p class="toc-title" tabindex="0" role="button" aria-expanded="true">On this page ${IC.chevSm}</p>
    <ul>
${lis}
    </ul>
  </aside>`;
}

function footer(source, site) {
  const brand = (site && site.productName) || 'Docs';
  const tagline = (site && site.footerTagline) || '';
  return `<footer class="foot">
  <div class="wrap">
    <span class="mono">${esc(brand)} · docs</span>
    <span>${esc(tagline)}</span>
    <span style="margin-left:auto" class="mono">${source ? 'Source: ' + esc(source) : 'Generated by tools/docs-gen'}</span>
  </div>
</footer>`;
}

export function hero({ eyebrow, title, lede, metaItems }) {
  const metas = (metaItems || [])
    .map((m) => `<span>${m}</span>`)
    .join('\n      ');
  return `<section class="hero">
  <div class="wrap">
    <div class="hero-rule" aria-hidden="true"></div>
    <p class="eyebrow">${esc(eyebrow)}</p>
    <h1>${title}</h1>
    <p class="lede">${lede}</p>
    ${metaItems && metaItems.length ? `<div class="hero-meta">\n      ${metas}\n    </div>` : ''}
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Code block (verbatim, CSS-styled, copy button)
// ---------------------------------------------------------------------------
let _uid = 0;
export function codeBlock({ lang, text, path, copyLabel }) {
  const id = `code-${++_uid}`;
  const cap = path ? `<span class="path">${esc(path)}</span>` : '';
  return `<figure class="code">
  <figcaption><span class="lang">${esc(lang || 'text')}</span>${cap}<span class="spacer"></span><button class="copy-btn" type="button" data-copy-target="#${id}" aria-label="${esc(copyLabel || 'Copy code')}">${IC.copy}Copy</button></figcaption>
  <pre><code id="${id}">${esc(text)}</code></pre>
</figure>`;
}

// ---------------------------------------------------------------------------
// Markdown prose → HTML (tables, lists, inline code, links)
// ---------------------------------------------------------------------------
export function prose(markdown) {
  if (!markdown || !markdown.trim()) return '';
  // markdown-it renders tables with default classes; add ours via a post-pass.
  let html = md.render(markdown);
  html = html.replace(/<table>/g, '<div class="table-wrap"><table class="data">').replace(/<\/table>/g, '</table></div>');
  return html;
}

// inline markdown (no <p> wrapper) for short strings like scope ledes, closes refs
export function inlineProse(markdown) {
  if (!markdown) return '';
  return md.renderInline(markdown);
}

// ---------------------------------------------------------------------------
// Cycle card (plan page)
// ---------------------------------------------------------------------------
export function cycleCard(cycle, { open = false } = {}) {
  const arch = cycle.archReview;
  // 4-state architecture-review badge: top (accent) / mid (wip) / none (idle) /
  // deferred (info — links to the referenced cycle's anchor on this page).
  let archBadge;
  if (arch.tier === 'deferred') {
    const title = arch.reason ? ` title="${esc(arch.reason)}"` : '';
    if (arch.deferTo) {
      archBadge = `<a class="pill info" href="#${esc(anchorId(arch.deferTo))}"${title}><span class="dot"></span>architect: deferred to ${esc(arch.deferTo)}</a>`;
    } else {
      archBadge = `<span class="pill info"${title}><span class="dot"></span>architect: deferred</span>`;
    }
  } else {
    const archClass = arch.tier === 'top' ? 'accent' : arch.tier === 'mid' ? 'wip' : 'idle';
    const archText = arch.tier === 'none' ? 'architect: none' : `architect: required (${arch.tier})`;
    const archTitle = arch.reason ? ` title="${esc(arch.reason)}"` : '';
    archBadge = `<span class="pill ${archClass}"${archTitle}><span class="dot"></span>${esc(archText)}</span>`;
  }

  const closesPill = cycle.closes
    ? `<span class="pill"><span class="dot"></span>Closes: ${esc(truncate(stripTrailingPunct(cycle.closes), 42))}</span>`
    : '';
  const secPill = cycle.securityTier ? '<span class="pill warn"><span class="dot"></span>security tier</span>' : '';
  const depPill = cycle.dependsOn ? `<span class="pill"><span class="dot"></span>Depends on: ${esc(truncate(cycle.dependsOn, 38))}</span>` : '';
  const noTddTag = cycle.noTdd ? '<span class="tag-muted">no TDD cycles</span>' : '';

  const phasesHtml = cycle.phases.map((p) => phaseBlock(p)).join('\n');

  const scopeHtml = cycle.scope ? `<div class="cycle-scope">${prose(cycle.scope)}</div>` : '';

  return `<details class="cycle-card section" id="${esc(anchorId(cycle.id))}"${open ? ' open' : ''}>
  <summary class="cycle-head">
    <span class="cycle-id">${esc(cycle.id)}</span>
    <span class="cycle-titlewrap">
      <h3 class="cycle-title">${inlineProse(cycle.title)}</h3>
      <span class="cycle-meta">
        <span class="chip owner-chip">${IC.user}${esc(cycle.owner || 'team')}</span>
        ${archBadge}
        ${secPill}
        ${depPill}
        ${closesPill}
        ${noTddTag}
      </span>
    </span>
    ${IC.chev}
  </summary>
  <div class="cycle-body">
    ${scopeHtml}
    ${arch.reason || arch.tier === 'deferred' ? `<p class="phase-note" style="font-size:.86rem;color:var(--ink-3);margin:0 0 4px"><strong style="color:var(--ink-2)">Architecture review.</strong> ${inlineProse(escReason(arch.tier, arch.reason, arch.deferTo))}</p>` : ''}
${phasesHtml}
  </div>
</details>`;
}

function escReason(tier, reason, deferTo) {
  if (tier === 'none') return `none — ${reason}`;
  if (tier === 'deferred') return `deferred to Cycle ${deferTo || ''}${reason ? ' — ' + reason : ''}`;
  return `required (${tier}) — ${reason}`;
}

function phaseBlock(p) {
  const cls = PHASE_LABELS[p.name] || 'review';
  const label = p.name;
  const meta = p.meta ? `<span class="meta">${esc(p.meta)}</span>` : '';
  const codeHtml = (p.code || [])
    .map((c) => codeBlock({ lang: c.lang, text: c.text }))
    .join('\n');
  const proseHtml = p.prose ? prose(p.prose) : '';
  return `    <div class="phase ${cls}">
      <div class="phase-head"><span class="tagdot"></span>${esc(label)}${meta}</div>
      <div class="phase-body">
        ${proseHtml}
        ${codeHtml}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Empty-table block (Open questions / follow-ups)
// ---------------------------------------------------------------------------
export function tableBlock(table, { placeholder } = {}) {
  if (!table || (table.rows.length === 0)) {
    const headers = (table && table.headers.length ? table.headers : ['—']).map((h) => `<th>${esc(h)}</th>`).join('');
    const note = (table && table.placeholder) || placeholder || 'Empty placeholder — populated as the plan progresses.';
    const span = (table && table.headers.length) || 1;
    return `<div class="table-wrap"><table class="data">
      <thead><tr>${headers}</tr></thead>
      <tbody><tr><td colspan="${span}" style="text-align:center;color:var(--ink-3);font-style:italic;padding:22px">${esc(note)}</td></tr></tbody>
    </table></div>`;
  }
  const thead = table.headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const tbody = table.rows
    .map((r) => '<tr>' + r.map((c) => `<td>${inlineProse(c)}</td>`).join('') + '</tr>')
    .join('\n');
  return `<div class="table-wrap"><table class="data">
    <thead><tr>${thead}</tr></thead>
    <tbody>${tbody}</tbody>
  </table></div>`;
}

// ---------------------------------------------------------------------------
// Progress dashboard (donut + status table)
// ---------------------------------------------------------------------------
export function progressDashboard(meta, plan, progress) {
  // The donut counts the cycle universe (meta cycles when available, else plan cycles).
  // The status TABLE reflects whatever rows the progress file actually carries, in source
  // order — so non-TDD "Phase" rows show up too. Falls back to the cycle universe when
  // there is no progress table at all.
  const universe = (meta && meta.cycles) ? meta.cycles.map((c) => c.id) : plan.cycles.map((c) => c.id);
  const total = universe.length || (progress.order ? progress.order.length : 0) || 1;
  const counts = progress.counts;
  const done = counts.ok || 0;
  const wip = counts.wip || 0;
  const idle = Math.max(0, total - done - wip);
  const circ = 301.6; // 2πr for r=48
  const doneArc = total ? (done / total) * circ : 0;

  const order = progress.order && progress.order.length ? progress.order : universe;
  const rows = order
    .map((id) => {
      const pg = progress.byId[id] || { status: 'idle', statusLabel: 'Not started', shipped: '—', notes: '—', desc: '' };
      return `            <tr><td class="mono">${esc(id)}</td><td>${esc(pg.desc || '')}</td><td>${statusPill(pg.status, pg.statusLabel)}</td><td class="mono">${esc(pg.shipped || '—')}</td><td>${esc(pg.notes || '—')}</td></tr>`;
    })
    .join('\n');

  return `<div class="panel">
        <div class="dash">
          <div class="donut-wrap" aria-hidden="true">
            <svg width="200" height="200" viewBox="0 0 120 120" role="img" aria-label="Progress donut: ${done} of ${total} cycles done">
              <circle cx="60" cy="60" r="48" fill="none" stroke="var(--surface-2)" stroke-width="14"/>
              <circle cx="60" cy="60" r="48" fill="none" stroke="var(--accent)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${doneArc.toFixed(1)} ${(circ - doneArc).toFixed(1)}" transform="rotate(-90 60 60)"/>
            </svg>
            <div class="donut-center">
              <div class="big">${done}<span style="color:var(--ink-faint);font-size:1.4rem">/${total}</span></div>
              <div class="small">Shipped</div>
            </div>
          </div>
          <div class="dash-legend">
            <div class="row"><span class="sw" style="background:var(--accent)"></span><span class="lbl">Shipped</span><span class="ct">${done}</span></div>
            <div class="row"><span class="sw" style="background:var(--wip-fg)"></span><span class="lbl">In progress</span><span class="ct">${wip}</span></div>
            <div class="row"><span class="sw" style="background:var(--surface-2);border:1px solid var(--line-strong)"></span><span class="lbl">Not started</span><span class="ct">${idle}</span></div>
          </div>
        </div>
      </div>

      <h3>Status table</h3>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Cycle</th><th>Description</th><th>Status</th><th>Shipped</th><th>Notes</th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
      </div>`;
}


export function statusPill(status, label) {
  return `<span class="pill ${status}"><span class="dot"></span>${esc(label)}</span>`;
}

// ---------------------------------------------------------------------------
// File-ownership matrix
// ---------------------------------------------------------------------------
const MATRIX_COLS = [
  { key: 'web', label: 'web', match: (d) => /apps\/web/.test(d) },
  { key: 'api', label: 'api', match: (d) => /apps\/api/.test(d) },
  { key: 'solver', label: 'solver', match: (d) => /services\/solver/.test(d) },
  // ocr/py: the OCR + import Python services, or a stray .py NOT under services/solver
  // (which has its own column above).
  { key: 'ocr', label: 'ocr / py', match: (d) => /services\/(ocr|import)/.test(d) || (/\.py$/.test(d) && !/services\/solver/.test(d)) },
  { key: 'supabase', label: 'supabase', match: (d) => /supabase/.test(d) },
  { key: 'infra', label: 'infra', match: (d) => /^infra\/|^scripts\/|\.github|Dockerfile|docker-compose|Caddyfile|caddy/.test(d) },
];

export function ownershipMatrix(meta) {
  const rows = meta.fileOwnership
    .map((o) => {
      const cells = MATRIX_COLS.map((col) => {
        const owns = (o.dirs || []).some((d) => col.match(d));
        return owns
          ? '<td class="own"><span class="dot" title="owns"></span></td>'
          : '<td class="own empty"></td>';
      }).join('');
      const newFiles = (o.newFiles || []).map((f) => `<code>${esc(f)}</code>`).join(' ');
      return `            <tr><td class="mono">${esc(o.cycle)}</td>${cells}<td style="font-size:.82rem">${newFiles}</td></tr>`;
    })
    .join('\n');
  const heads = MATRIX_COLS.map((c) => `<th>${esc(c.label)}</th>`).join('');
  return `<div class="table-wrap">
        <table class="data matrix">
          <thead><tr><th>Cycle</th>${heads}<th>New top-level files</th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
      </div>`;
}

// ---------------------------------------------------------------------------
// Collapsible prompt panel (verbatim copy)
// ---------------------------------------------------------------------------
export function promptPanel(session) {
  const id = `prompt-${++_uid}`;
  const pill = session.securityTier
    ? '<span class="pill warn"><span class="dot"></span>security tier</span>'
    : '<span class="pill"><span class="dot"></span>prompt</span>';
  const beforeHtml = session.before ? prose(session.before) : '';
  const afterHtml = session.after ? prose(session.after) : '';
  const promptFig = `<figure class="code">
            <figcaption><span class="lang">prompt</span><span class="path">paste verbatim into a fresh /clear session</span><span class="spacer"></span><button class="copy-btn" type="button" data-copy-target="#${id}" aria-label="Copy prompt for ${esc(session.title)}">${IC.copy}Copy prompt</button></figcaption>
            <pre><code id="${id}">${esc(session.prompt)}</code></pre>
          </figure>`;
  return `      <details class="collapse">
        <summary>${IC.chev}${esc(session.title)}<span class="spacer"></span>${pill}</summary>
        <div class="collapse-body">
          ${beforeHtml}
          ${session.prompt ? promptFig : '<p style="color:var(--ink-3)">No prompt block in source for this session.</p>'}
          ${afterHtml}
        </div>
      </details>`;
}

// ---------------------------------------------------------------------------
// Callouts / conventions
// ---------------------------------------------------------------------------
export function callout(kind, html) {
  const ic = kind === 'ok' ? IC.check : kind === 'warn' ? IC.warn : IC.info;
  return `<div class="callout ${kind === 'note' ? 'note' : kind}">
        ${ic}
        <p>${html}</p>
      </div>`;
}

export const ICONS = IC;
export { renderDag, renderTimeline, renderTddLoop };

// ---------------------------------------------------------------------------
// small string helpers
// ---------------------------------------------------------------------------
export function anchorId(cycleId) {
  return 'c' + cycleId.replace(/\./g, '-');
}
function truncate(s, n) {
  s = (s || '').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}
function stripTrailingPunct(s) {
  return (s || '').replace(/\.$/, '');
}
