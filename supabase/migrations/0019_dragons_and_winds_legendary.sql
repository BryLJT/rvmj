-- ============================================================================
-- 0019 — Big Three Dragons (大三元) and Small Four Winds (小四喜) become Legendary
--
-- Bryan, 2026-11-13. Both were Rare: 大三元 since 0001, 小四喜 since 0015, where it was set to
-- match Small Three Dragons. Both are now Legendary, alongside Great Winds (大四喜).
--
-- Rarity is read live from notable_hands on every request, never copied onto a win, so every win
-- already logged with either hand moves up on the board and in the photo archive straight away.
-- No other row changes. Small Three Dragons (小三元) stays Rare.
--
-- Matched by English name, which is how every catalogue migration since 0013 finds its rows. The
-- local name is checked as well, so a renamed row fails loudly here instead of being updated.
-- ============================================================================
begin;

update public.notable_hands
set rarity = 'legendary'
where (name, local_name) in (('Big Three Dragons', '大三元'), ('Small Four Winds', '小四喜'));

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.notable_hands
  where (name, local_name) in (('Big Three Dragons', '大三元'), ('Small Four Winds', '小四喜'))
    and rarity = 'legendary';
  if v_count <> 2 then
    raise exception 'expected both hands to be legendary, found %', v_count;
  end if;

  if (select rarity from public.notable_hands where name = 'Small Three Dragons') is distinct from 'rare' then
    raise exception 'Small Three Dragons should still be rare';
  end if;
end $$;

commit;
