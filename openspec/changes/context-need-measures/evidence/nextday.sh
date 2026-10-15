#!/bin/sh
# Replays rec-vanilla with omp's clock on the next calendar day, with and
# without pinning the original date.
set -e
printf '#!/bin/sh\nTZ=Pacific/Kiritimati exec /home/zero/.local/share/mise/installs/github-can1357-oh-my-pi/18.10.4/omp "$@"\n' > /tmp/pichart-replay/omp-nextday
chmod +x /tmp/pichart-replay/omp-nextday
cd "$(dirname "$0")"
J=$(jq -r .journal /tmp/pichart-replay/rec-vanilla/manifest.json)
C=$(jq -r .commit /tmp/pichart-replay/rec-vanilla/manifest.json)
for v in nextday nextday-pinned; do
	flag=""
	[ "$v" = nextday ] && flag="--today-now"
	bun replay.ts replay --journal "$J" --arm vanilla --commit "$C" --omp /tmp/pichart-replay/omp-nextday $flag --out "/tmp/pichart-replay/rep-vanilla-$v" 2>&1 | grep -v 'exit 0$' || true
	bun replay.ts check --journal "$J" --replay "/tmp/pichart-replay/rep-vanilla-$v" --record /tmp/pichart-replay/rec-vanilla > "runs/check-vanilla-$v.json"
	echo "$v $(jq -c '.summary | del(.journal)' "runs/check-vanilla-$v.json")"
done
