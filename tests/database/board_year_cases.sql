\set ON_ERROR_STOP on

-- Fixture for migration 0008's per-year boards, run against a database rebuilt from 0001-0008.
--
-- It exists because the reconciliation assertion inside 0008 itself is VACUOUS in a fresh
-- replay: at migration time no game has ended, so summing across an empty set trivially agrees
-- with an empty all-time board. That copy is not vacuous on hosted, where real games exist,
-- which is why it stays in the migration -- but here it proves nothing without data.
--
-- Discovered on 2026-08-27 by doubling the per-year sum and watching the whole suite pass.
--
-- Two ended games in DIFFERENT academic years, with unequal, non-zero totals. Both are needed:
-- equal totals would survive a doubling bug (2 x 0 is still 0), and a single year would survive
-- a bug that summed only the most recent one.
insert into tables (id, code, label)
  values ('0d000000-0000-0000-0000-0000000000ff', 'BOARDYEAR', 'per-year board fixture');

-- AY25/26: ended 1 November 2025.
insert into games (id, table_id, mode, status, started_at, ended_at) values
  ('0d000000-0000-0000-0000-00000000a001', '0d000000-0000-0000-0000-0000000000ff',
   'chips', 'ended', timestamptz '2025-11-01 10:00+08', timestamptz '2025-11-01 12:00+08');
insert into game_players (game_id, player_id, seat, final_total) values
  ('0d000000-0000-0000-0000-00000000a001', '0c000000-0000-0000-0000-000000000001', 'E',  120),
  ('0d000000-0000-0000-0000-00000000a001', '0c000000-0000-0000-0000-000000000002', 'S',  -40),
  ('0d000000-0000-0000-0000-00000000a001', '0c000000-0000-0000-0000-000000000003', 'W',  -50),
  ('0d000000-0000-0000-0000-00000000a001', '0c000000-0000-0000-0000-000000000004', 'N',  -30);

-- AY26/27: ended 1 November 2026. Same four players, different amounts, so a per-player sum
-- across years is the only way to arrive at the all-time figure.
insert into games (id, table_id, mode, status, started_at, ended_at) values
  ('0d000000-0000-0000-0000-00000000a002', '0d000000-0000-0000-0000-0000000000ff',
   'chips', 'ended', timestamptz '2026-11-01 10:00+08', timestamptz '2026-11-01 12:00+08');
insert into game_players (game_id, player_id, seat, final_total) values
  ('0d000000-0000-0000-0000-00000000a002', '0c000000-0000-0000-0000-000000000001', 'E',   80),
  ('0d000000-0000-0000-0000-00000000a002', '0c000000-0000-0000-0000-000000000002', 'S',   20),
  ('0d000000-0000-0000-0000-00000000a002', '0c000000-0000-0000-0000-000000000003', 'W',  -60),
  ('0d000000-0000-0000-0000-00000000a002', '0c000000-0000-0000-0000-000000000004', 'N',  -40);

-- THE BOUNDARY CASE, and the reason §3.1 of the spec exists. This game ended at 00:30 Singapore
-- on Monday 3 August 2026, the first day of AY26/27 -- but it is stored as 16:30 UTC on Sunday
-- 2 August, which a naive reading files a whole year early. Mahjong runs late; this is a real
-- night of play, not a hypothetical.
insert into games (id, table_id, mode, status, started_at, ended_at) values
  ('0d000000-0000-0000-0000-00000000a003', '0d000000-0000-0000-0000-0000000000ff',
   'chips', 'ended', timestamptz '2026-08-02 20:00+08', timestamptz '2026-08-02 16:30+00');
insert into game_players (game_id, player_id, seat, final_total) values
  ('0d000000-0000-0000-0000-00000000a003', '0c000000-0000-0000-0000-000000000001', 'E',    7),
  ('0d000000-0000-0000-0000-00000000a003', '0c000000-0000-0000-0000-000000000002', 'S',   -7),
  ('0d000000-0000-0000-0000-00000000a003', '0c000000-0000-0000-0000-000000000003', 'W',    0),
  ('0d000000-0000-0000-0000-00000000a003', '0c000000-0000-0000-0000-000000000004', 'N',    0);
