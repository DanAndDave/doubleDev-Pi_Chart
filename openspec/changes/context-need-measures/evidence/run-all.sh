#!/bin/sh
# Ticket 04: replays the four Runs the Resolution reports and writes one
# check per Run into runs/. Stub replays only: no model spend. Needs the
# compose Thread Store up, omp 18.10.4 under mise, and the four Journals
# under ~/.omp/agent/sessions. Captures go to /tmp/pichart-replay (large).
set -e
cd "$(dirname "$0")"
S="$HOME/.omp/agent/sessions"
T=/tmp/pichart-replay

one() { # name arm journal commit [record-dir]
	bun replay.ts replay --journal "$3" --arm "$2" --commit "$4" --out "$T/rep-$1" 2>&1 | grep -v 'exit 0$' || true
	if [ -n "$5" ]; then
		bun replay.ts check --journal "$3" --replay "$T/rep-$1" --record "$5" > "runs/check-$1.json"
	else
		bun replay.ts check --journal "$3" --replay "$T/rep-$1" > "runs/check-$1.json"
	fi
	echo "$1 $(jq -c '.summary | del(.journal)' "runs/check-$1.json")"
}

# The 40-Turn benches of 2026-10-14 (scripts/bench-tokens.ts at c6fe516).
one bench-vanilla-CeFV8o vanilla "$(ls "$S"/-tmp-pichart-bench-CeFV8o/*.jsonl)" c6fe516
one bench-pichart-Ne5DGE pi-chart "$(ls "$S"/-tmp-pichart-bench-Ne5DGE/*.jsonl)" c6fe516

# The 3-Turn Runs recorded with captured requests (bun replay.ts record …).
for arm in vanilla pichart; do
	m="$T/rec-$arm/manifest.json"
	a=$([ "$arm" = pichart ] && echo pi-chart || echo vanilla)
	one "$arm" "$a" "$(jq -r .journal "$m")" "$(jq -r .commit "$m")" "$T/rec-$arm"
done
