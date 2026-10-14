-- Structure audit for structure-match-precision.
-- Run: psql "$PICHART_DATABASE_URL" -AF' | ' -v since="'2026-10-13'" -v until="'2026-10-14 06:00'" -f structure-audit.sql
-- A slot is one symbol one structure part carried. It is correct when its
-- file was named or read anywhere in the Turn, or when the Turn's final
-- reply writes its name as code (`name`, .name or name().
-- It is correct_first when the file evidence cannot be a re-read: the
-- prompt names the file, or the Turn's messages show it and no earlier Turn
-- of the Conversation did. Trimming context makes an agent re-read files it
-- saw Turns ago, and each re-read would otherwise count as a correct slot.
with c as (
  select t.conversation_id
  from turns t join call_accounting a using (conversation_id)
  where t.codebase like '/tmp/pichart-bench-%'
  group by t.conversation_id
  having min(a.recorded_at) >= :since and min(a.recorded_at) < :until
),
parts as (
  select a.conversation_id, a.turn_index, a.call_index, e as part
  from call_accounting a join c using (conversation_id),
  jsonb_array_elements(case jsonb_typeof(a.parts)
    when 'array' then a.parts
    when 'string' then (a.parts #>> '{}')::jsonb
    else '[]' end) e
  where e->>'source' = 'structure'
),
calls as (
  select *, part->'symbols' syms, (part->>'approximateTokens')::int tok,
    lag(part->'symbols') over (partition by conversation_id, turn_index order by call_index) prev
  from parts
),
slots as (
  select conversation_id, turn_index, x sym,
    substring(x from '\(([^:)]+):L') file,
    substring(x from '^\.?([A-Za-z_0-9]+)') name
  from calls, jsonb_array_elements_text(syms) x
),
turn_text as (
  select t.conversation_id, t.turn_index, t.prompt,
    coalesce(string_agg(m.message::text, ' '), '') msgtext,
    t.prompt || ' ' || coalesce(string_agg(m.message::text, ' '), '') alltext,
    (select m2.message::text from turn_messages m2
      where m2.conversation_id = t.conversation_id and m2.turn_index = t.turn_index
        and m2.role = 'assistant'
      order by m2.call_index desc, m2.ordinal desc limit 1) reply
  from turns t join c using (conversation_id)
  left join turn_messages m using (conversation_id, turn_index)
  group by t.conversation_id, t.turn_index, t.prompt
),
judged as (
  select s.*,
    position(s.file in tt.alltext) > 0 or reply_names correct,
    position(s.file in tt.prompt) > 0
      or (position(s.file in tt.msgtext) > 0 and not exists (
        select 1 from turn_text e
        where e.conversation_id = s.conversation_id and e.turn_index < s.turn_index
          and position(s.file in e.alltext) > 0))
      or reply_names correct_first
  from slots s join turn_text tt using (conversation_id, turn_index),
  lateral (select tt.reply ~ ('(`|\.)' || s.name || '\M|\m' || s.name || '\(') reply_names) r
)
select
  (select count(distinct conversation_id) from calls) conversations,
  (select count(*) from judged) slots,
  (select count(*) filter (where correct) from judged) correct,
  (select round(100.0 * count(*) filter (where correct) / nullif(count(*), 0), 1) from judged) correct_pct,
  (select count(*) filter (where correct_first) from judged) correct_first,
  (select round(100.0 * count(*) filter (where correct_first) / nullif(count(*), 0), 1) from judged) correct_first_pct,
  (select count(prev) from calls) pairs,
  (select count(*) filter (where prev is not null and prev <> syms) from calls) changed,
  (select round(100.0 * count(*) filter (where prev is not null and prev <> syms) / nullif(count(prev), 0), 1) from calls) changed_pct,
  (select round(avg(tok)) from calls) avg_tokens,
  -- What a Call pays for structure since pack-parts-follow-the-turn: a
  -- changed part is re-written, an unchanged one is read from cache.
  (select round(sum(tok) filter (where prev is not null and prev <> syms)::numeric / nullif(count(prev), 0)) from calls) rewritten_per_pair,
  -- Slots in a test or script file, by the rule in design §6.
  (select round(100.0 * count(*) filter (where file ~ '(^|/)(tests?|__tests__|scripts)/|[._]test\.|\.spec\.|(^|/)test_[^/]*$') / nullif(count(*), 0), 1) from judged) held_back_share;
