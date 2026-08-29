begin;

-- Two more catalogue rows, at Bryan's request (2026-08-29).
--
-- The catalogue is REFERENCE data, seeded in 0001, so it belongs in a migration rather than a
-- hand-written insert against production. A hand insert would exist only on hosted: every fresh
-- database, the local stack, and this harness would still carry twelve, and the divergence is
-- silent until something depends on it.
--
-- Both are filed 'uncommon' because `rarity` accepts only uncommon/rare/legendary and these are
-- the least exceptional tier available. Noted honestly: neither is a rare pattern in the sense
-- the other twelve are. Ping hu is the baseline hand, and zi mo describes HOW a hand was won
-- rather than what it was. Bryan was shown that the Notable wins board ranks a win by how many
-- labels it carries, so labels that attach to ordinary wins dilute that ordering, and chose to
-- add them anyway. Recorded here so a later reader does not mistake it for an oversight.
--
-- Local names follow the existing rows' simplified-character convention. If 平胡 should read
-- 平和 for this table, correct it in a later migration rather than editing this one.
--
-- Guarded with `where not exists` on the name so re-application cannot duplicate a row:
-- `notable_hands` has no unique constraint on `name`, only on `id`.

insert into public.notable_hands (name, local_name, rarity)
select v.name, v.local_name, v.rarity
from (values
  ('Ping Hu', '平胡', 'uncommon'),
  ('Zi Mo',   '自摸', 'uncommon')
) as v(name, local_name, rarity)
where not exists (
  select 1 from public.notable_hands h where h.name = v.name
);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.notable_hands
  where name in ('Ping Hu', 'Zi Mo');
  if v_count <> 2 then
    raise exception 'expected exactly 2 new catalogue rows, found %', v_count;
  end if;

  select count(*) into v_count from public.notable_hands;
  if v_count <> 14 then
    raise exception 'expected a 14-row catalogue after this migration, found %', v_count;
  end if;
end $$;

commit;
