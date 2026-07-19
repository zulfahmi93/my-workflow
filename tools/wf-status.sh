#!/bin/bash
# What are my background workflows actually doing?
#
#   wf-status.sh              every workflow with an agent still running
#   wf-status.sh -a           include finished workflows
#   wf-status.sh -f           refresh every 20s until Ctrl-C
#   wf-status.sh -n 20        show 20 recent actions per agent (default 8)
#   wf-status.sh -s <dir>     look in a different session's workflow dir
#
# WHY THIS EXISTS. The workflow journal records only agent `started` and `result` events, so a
# single long-running agent leaves the journal untouched for 20+ minutes while it works. Journal
# staleness therefore says nothing about liveness, and "no output" does not mean "stuck" — the
# output only appears when the whole workflow returns. The real signal is per-agent: which agents
# have started with no result, and when did THEIR OWN transcript last grow.
set -uo pipefail

SESSIONS_ROOT="${HOME}/.claude/projects"
SESSION_DIR=""
TAIL=8
FOLLOW=0
ALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    -f) FOLLOW=1; shift ;;
    -a) ALL=1; shift ;;
    -n) TAIL="$2"; shift 2 ;;
    -s) SESSION_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1 (try -h)" >&2; exit 2 ;;
  esac
done

# Default to whichever session has the most recently touched workflow dir, so this works
# without arguments from any project.
if [ -z "$SESSION_DIR" ]; then
  SESSION_DIR=$(find "$SESSIONS_ROOT" -type d -name workflows -path '*/subagents/*' 2>/dev/null \
    | while read -r d; do echo "$(stat -f %m "$d") $d"; done | sort -rn | head -1 | cut -d' ' -f2-)
fi
[ -n "$SESSION_DIR" ] && [ -d "$SESSION_DIR" ] || { echo "no workflow directory found under $SESSIONS_ROOT" >&2; exit 1; }

human() { # seconds -> 3m12s
  local s=$1
  if [ "$s" -lt 60 ]; then echo "${s}s"; else echo "$((s/60))m$((s%60))s"; fi
}

snapshot() {
  echo "=== $(date '+%H:%M:%S')  $(basename "$(dirname "$(dirname "$SESSION_DIR")")") ==="
  local any=0
  # Newest workflow first — that is nearly always the one being asked about.
  for wf in $(ls -td "$SESSION_DIR"/wf_* 2>/dev/null); do
    [ -f "$wf/journal.jsonl" ] || continue
    local report
    report=$(python3 - "$wf" "$TAIL" "$ALL" <<'PY'
import calendar, json, os, sys, time, glob

wf, tail, show_all = sys.argv[1], int(sys.argv[2]), sys.argv[3] == '1'
jpath = os.path.join(wf, 'journal.jsonl')

started, done = [], set()
for line in open(jpath):
    try: d = json.loads(line)
    except ValueError: continue
    if d.get('type') == 'started': started.append(d['agentId'])
    elif d.get('type') == 'result': done.add(d.get('agentId'))
inflight = [a for a in started if a not in done]
if not inflight and not show_all:
    sys.exit(0)

now = time.time()
# Workflow age from the oldest artefact in its directory.
files = glob.glob(os.path.join(wf, '*'))
age = int(now - min(os.path.getctime(f) for f in files)) if files else 0
state = f"{len(done)}/{len(started)} agents done"
print(f"\n▸ {os.path.basename(wf)}   running {age//60}m{age%60:02d}s   {state}"
      + ("   [FINISHED]" if not inflight else ""))

def role_of(agent):
    """agentType is in meta.json; the actual job is stated in the agent's own opening prompt."""
    kind = '?'
    meta = os.path.join(wf, f'agent-{agent}.meta.json')
    if os.path.exists(meta):
        try: kind = json.load(open(meta)).get('agentType', '?')
        except Exception: pass
    job = ''
    tpath = os.path.join(wf, f'agent-{agent}.jsonl')
    if os.path.exists(tpath):
        with open(tpath) as fh:
            for line in fh:
                try: d = json.loads(line)
                except ValueError: continue
                if d.get('type') != 'user': continue
                c = (d.get('message') or {}).get('content')
                text = c if isinstance(c, str) else ' '.join(
                    b.get('text', '') for b in (c or []) if isinstance(b, dict))
                for marker in ('RED phase', 'GREEN phase', 'AUTHOR phase', 'COMMIT GATE',
                               'independent REVIEW gate', 'INDEPENDENT verifier',
                               'REFACTOR phase', 'Adversarially verify', 'architecture gate'):
                    if marker in text:
                        job = marker
                        break
                break
    return kind, job

for agent in inflight:
    tpath = os.path.join(wf, f'agent-{agent}.jsonl')
    kind, job = role_of(agent)
    if not os.path.exists(tpath):
        print(f"  · {kind} — starting up (no transcript yet)")
        continue
    idle = int(now - os.path.getmtime(tpath))
    # ctime tracks the last inode change, which every write bumps — it equals mtime and is
    # useless as a start time. Take the first timestamp the transcript itself records.
    alive = idle
    try:
        for line in open(tpath):
            d = json.loads(line)
            ts = d.get('timestamp')
            if ts:
                # Transcript timestamps are UTC (trailing Z); timegm avoids the local-offset
                # error mktime introduces.
                alive = int(now - calendar.timegm(time.strptime(ts[:19], '%Y-%m-%dT%H:%M:%S')))
                break
    except Exception:
        pass
    flag = '  ⚠ IDLE' if idle > 300 else ''
    print(f"  · {kind}{' — ' + job if job else ''}"
          f"   alive {alive//60}m{alive%60:02d}s   last activity {idle}s ago{flag}")

    rows, tools = [], 0
    for line in open(tpath):
        try: d = json.loads(line)
        except ValueError: continue
        if d.get('type') != 'assistant': continue
        for b in (d.get('message') or {}).get('content') or []:
            if b.get('type') == 'tool_use':
                tools += 1
                i = b.get('input') or {}
                arg = i.get('file_path') or i.get('command') or i.get('pattern') or i.get('description') or ''
                arg = ' '.join(str(arg).split())
                rows.append(f"      {b.get('name'):<6} {arg[:88]}")
            elif b.get('type') == 'thinking':
                t = ' '.join((b.get('thinking') or '').split())
                if t: rows.append(f"      think  {t[:88]}")
    print(f"      ({tools} tool calls so far)")
    for r in rows[-tail:]:
        print(r)
PY
)
    if [ -n "$report" ]; then printf '%s\n' "$report"; any=1; fi
  done
  [ "$any" = 0 ] && echo "  (no workflows running)"
  return 0
}

if [ "$FOLLOW" = 1 ]; then
  while true; do snapshot; sleep 20; done
else
  snapshot
fi
