-- Findings audit for docs/benchmarks/2026-10-13-token-usage.md.
-- Reads the Thread Store's call_accounting rows of that run's three pi-chart
-- Conversations, found by their Codebases in 2026-10-13-token-usage.json.
-- Run: psql "$(cat ~/.pi-chart/database.url)" -AF' | ' -f audit.sql
create temporary view bench as
select distinct t.conversation_id, t.codebase,
  case t.codebase
    when '/tmp/pichart-bench-fMQcHA' then 0
    when '/tmp/pichart-bench-ksa1Oo' then 1
    when '/tmp/pichart-bench-41BItz' then 2
  end run
from turns t
where t.codebase in ('/tmp/pichart-bench-fMQcHA', '/tmp/pichart-bench-ksa1Oo', '/tmp/pichart-bench-41BItz');

-- parts is stored as a jsonb array or as a jsonb string holding one.
create temporary view part as
select b.run, a.conversation_id, a.turn_index, a.call_index, a.leading_tokens,
  e->>'source' source, e
from call_accounting a join bench b using (conversation_id),
jsonb_array_elements(case jsonb_typeof(a.parts)
  when 'array' then a.parts
  when 'string' then (a.parts #>> '{}')::jsonb
  else '[]' end) e;

-- 1. Part churn: how often each assembled part differs from the same part
-- on the previous Call of the same Turn. Turns are 1-based here, as in the
-- document.
with pairs as (
  select source, turn_index + 1 turn, e,
    lag(e) over (partition by conversation_id, turn_index, source order by call_index) prev
  from part
  where source in ('structure', 'recalled', 'curated', 'pinned')
)
select source,
  case when turn <= 6 then '1-6' else '7-12' end turns,
  count(prev) pairs,
  count(*) filter (where prev is not null and prev <> e) changed
from pairs
group by 1, 2
order by 1, 2;

-- 2. Leading run: tokens of the run the harness sent ahead of the assembled
-- parts, per run and Turn (min and max over the Turn's Calls).
select run, turn_index + 1 turn,
  min(leading_tokens) min_leading, max(leading_tokens) max_leading
from (select distinct run, conversation_id, turn_index, call_index, leading_tokens from part) c
group by 1, 2
order by 1, 2;

-- 3. Recall at turn 12: what the recalled part did with turn 1 (index 0) on
-- the first Call of turn 12.
select run,
  e->'turnIndices' @> '[0]' carried_turn_1,
  x->>'reason' reason,
  round((x->>'distance')::numeric, 4) distance,
  x->>'threshold' threshold
from part
left join lateral (
  select x from jsonb_array_elements(e->'excludedCandidates') x
  where (x->>'turnIndex')::int = 0
) ex on true
where source = 'recalled' and turn_index = 11 and call_index = 0
order by run;
