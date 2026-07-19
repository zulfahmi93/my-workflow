#!/usr/bin/env node
// Mechanically verify `path:line` citations in prose.
//
// Docs in this repo cite source by file and line — `system.rs:274`, `speed_rate_deriver.dart:213-215`.
// Those citations rot every time the cited file changes, and finding the rot has been costing a
// reviewer dozens of Read calls per cycle to discover what a grep settles in one pass. This does the
// deterministic half so review agents spend their budget on judgement instead of discovery.
//
//   node scripts/check-citations.mjs <path>...        files or directories
//   node scripts/check-citations.mjs --repo <dir> …   resolve citations against <dir> (default: cwd)
//   node scripts/check-citations.mjs --also <dir> …   additional search root, repeatable
//
// --also matters here: this project's docs cite the upstream agent's Rust source, which lives in a
// separate repo entirely. Without it every `system.rs:274` reads as UNRESOLVED and the real
// findings drown in false positives.
//
// Reports, per citation: MISSING (no such file) or OUT-OF-RANGE (line past EOF). A citation whose
// target file cannot be located anywhere is reported UNRESOLVED rather than silently skipped —
// silence is how a wrong path survives.
//
// Exits 1 if any citation is broken, 0 otherwise.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, basename, extname } from 'node:path'

const SCAN_EXT = new Set(['.md', '.yaml', '.yml'])
// Extensions worth resolving. A bare `foo.dart:12` is a citation; `1.2:` in prose is not.
const CITED_EXT = new Set(['.dart', '.rs', '.md', '.yaml', '.yml', '.kts', '.xml', '.plist', '.json', '.mjs', '.js', '.py', '.sh'])
// Directories not worth SCANNING for citations. They are still INDEXED as citation targets —
// docs legitimately cite android/app/build.gradle.kts and ios/Runner/Info.plist, and skipping
// them at index time reported real files as UNRESOLVED, which is a false positive that
// devalues the whole report.
const SKIP_SCAN = new Set(['node_modules', '.git', 'html', 'build', '.dart_tool', 'private'])
const SKIP_INDEX = new Set(['node_modules', '.git', 'html', 'build', '.dart_tool', 'private'])

// `docs/adr/0015-x.md:120-140` or `system.rs:274`. Requires an extension so plan ids and
// cycle numbers ("plan-008.yaml" is fine, "8.3:" is not) cannot masquerade as citations.
const CITATION = /(?<![\w/.-])((?:[\w.-]+\/)*[\w.-]+\.[a-z]{1,6}):(\d+)(?:-(\d+))?(?![\w-])/gi

const args = process.argv.slice(2)
let repoRoot = process.cwd()
const alsoRoots = []
const targets = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--repo') { repoRoot = resolve(args[++i]); continue }
  if (args[i] === '--also') { alsoRoots.push(resolve(args[++i])); continue }
  targets.push(args[i])
}
if (!targets.length) {
  console.error('usage: check-citations.mjs [--repo DIR] <file-or-dir>...')
  process.exit(2)
}

function walk(p, out = []) {
  const st = statSync(p)
  if (st.isDirectory()) {
    if (SKIP_SCAN.has(basename(p))) return out
    for (const e of readdirSync(p)) walk(join(p, e), out)
  } else if (SCAN_EXT.has(extname(p))) {
    out.push(p)
  }
  return out
}

// Index every file in the repo by basename, so a citation written relative to a different
// directory still resolves. Ambiguous basenames fall back to path-suffix matching.
const byBase = new Map()
function index(dir) {
  let entries
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    if (SKIP_INDEX.has(e)) continue
    const p = join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) index(p)
    else {
      if (!byBase.has(e)) byBase.set(e, [])
      byBase.get(e).push(p)
    }
  }
}
index(repoRoot)
for (const r of alsoRoots) index(r)

const lineCache = new Map()
function lineCount(p) {
  if (!lineCache.has(p)) {
    try { lineCache.set(p, readFileSync(p, 'utf8').split('\n').length) }
    catch { lineCache.set(p, null) }
  }
  return lineCache.get(p)
}

function resolveCited(cited) {
  const direct = resolve(repoRoot, cited)
  if (existsSync(direct) && statSync(direct).isFile()) return [direct]
  const cands = byBase.get(basename(cited)) || []
  if (cands.length <= 1) return cands
  // Prefer a candidate whose path ends with the cited path, so `core/format.dart:21`
  // picks lib/core/format.dart over a same-named file elsewhere.
  const suffix = cands.filter(c => c.endsWith('/' + cited))
  return suffix.length ? suffix : cands
}

let broken = 0
let checked = 0
const findings = []

for (const t of targets) {
  for (const file of walk(resolve(t))) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, idx) => {
      for (const m of line.matchAll(CITATION)) {
        const [, cited, startStr, endStr] = m
        if (!CITED_EXT.has(extname(cited))) continue
        checked++
        const hits = resolveCited(cited)
        const rel = file.startsWith(repoRoot) ? file.slice(repoRoot.length + 1) : file
        if (!hits.length) {
          broken++
          findings.push(`${rel}:${idx + 1}  UNRESOLVED  ${cited}:${startStr} — no such file in repo`)
          continue
        }
        // A citation is broken only if EVERY candidate is out of range; an ambiguous
        // basename that resolves correctly somewhere is not a defect.
        const worst = hits.map(h => ({ h, n: lineCount(h) })).filter(x => x.n != null)
        if (!worst.length) continue
        const end = Number(endStr || startStr)
        const ok = worst.some(x => end <= x.n)
        if (!ok) {
          broken++
          const best = worst[0]
          const target = best.h.startsWith(repoRoot) ? best.h.slice(repoRoot.length + 1) : best.h
          findings.push(`${rel}:${idx + 1}  OUT-OF-RANGE  ${cited}:${startStr}${endStr ? '-' + endStr : ''} — ${target} has ${best.n} lines`)
        }
      }
    })
  }
}

for (const f of findings) console.log(f)
console.log(`\ncitations: ${checked} checked, ${broken} broken.`)
process.exit(broken ? 1 : 0)
