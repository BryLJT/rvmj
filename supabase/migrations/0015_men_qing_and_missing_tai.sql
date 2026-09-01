begin;

-- Nine more catalogue rows, at Bryan's request (2026-09-02).
--
-- Men Qing (门清) and Hua Shang (花上自摸) were the original ask. Hua Shang's characters were
-- confirmed by Bryan in chat: winning by self-draw on the replacement tile drawn immediately
-- after a flower/animal tile -- the flower-tile sibling of 'Kong on Kong' (杠上开花), which the
-- catalogue already carries as the equivalent event for a kong replacement draw.
--
-- The remaining seven were raised by Alfred as a gap analysis against the standard Cantonese /
-- old-Hong-Kong tai list this catalogue otherwise tracks closely, shown to Bryan with example
-- tile breakdowns, and approved in full including Last Discard Catch.
--
-- Rarity is Alfred's judgement call, not individually specified by Bryan, and is flagged as such
-- in the session response rather than treated as settled:
--   - Men Qing, Hua Shang: 'uncommon' per Bryan's original explicit instruction.
--   - Last Discard Catch (河底捞鱼): mirrors 'Last Tile Catch' (海底捞月, rare) -- same event,
--     opposite end of the wall (claimed discard vs self-drawn final tile).
--   - Small Four Winds (小四喜): mirrors 'Small Three Dragons' (小三元, rare) -- three pungs of
--     one honor category plus the pair of the last, one tier below the 'big' version.
--   - Four Concealed Pungs (四暗刻), All Honors (字一色), All Green (绿一色), Nine Gates
--     (九莲宝灯): each a limit-or-near-limit hand in most scoring systems, filed alongside the
--     existing legendary tier (Thirteen Wonders, Heavenly/Earthly Hand, Great Winds).
--   - All Simples (断幺): no terminals or honors anywhere in the hand -- far more frequent than
--     the legendary tier, filed 'uncommon' alongside All Pungs and the two circumstance hands
--     from 0013 (Ping Hu, Zi Mo).
--
-- Guarded with `where not exists` on the name, same as every prior seed addition: `notable_hands`
-- has no unique constraint on `name`, only on `id`, so re-application must not duplicate a row.

insert into public.notable_hands (name, local_name, rarity)
select v.name, v.local_name, v.rarity
from (values
  ('Men Qing',            '门清',     'uncommon'),
  ('Hua Shang',           '花上自摸', 'uncommon'),
  ('All Simples',         '断幺',     'uncommon'),
  ('Last Discard Catch',  '河底捞鱼', 'rare'),
  ('Small Four Winds',    '小四喜',   'rare'),
  ('Four Concealed Pungs','四暗刻',   'legendary'),
  ('All Honors',          '字一色',   'legendary'),
  ('All Green',           '绿一色',   'legendary'),
  ('Nine Gates',          '九莲宝灯', 'legendary')
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
  where name in (
    'Men Qing', 'Hua Shang', 'All Simples', 'Last Discard Catch', 'Small Four Winds',
    'Four Concealed Pungs', 'All Honors', 'All Green', 'Nine Gates'
  );
  if v_count <> 9 then
    raise exception 'expected exactly 9 new catalogue rows, found %', v_count;
  end if;

  select count(*) into v_count from public.notable_hands;
  if v_count <> 23 then
    raise exception 'expected a 23-row catalogue after this migration, found %', v_count;
  end if;
end $$;

commit;
