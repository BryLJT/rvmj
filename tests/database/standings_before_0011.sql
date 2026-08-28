\set ON_ERROR_STOP on

-- Hosted-style data that exists before 0011. The fixed IDs let the post-migration cases prove
-- that the original claim itself (rather than a newly-created equivalent) was preserved.
insert into auth.users (id, email, raw_user_meta_data) values
  ('50000000-0000-0000-0000-000000000001', 'standings-east@example.com', '{"full_name":"Standings East"}'),
  ('50000000-0000-0000-0000-000000000002', 'standings-south@example.com', '{"full_name":"Standings South"}'),
  ('50000000-0000-0000-0000-000000000003', 'standings-west@example.com', '{"full_name":"Standings West"}'),
  ('50000000-0000-0000-0000-000000000004', 'standings-north@example.com', '{"full_name":"Standings North"}');

insert into tables (id, code, label) values
  ('53000000-0000-0000-0000-000000000001', 'standings-before-0011', 'Standings pre-0011');

insert into games (id, table_id, mode, status, created_at, started_at, ended_at, last_activity_at)
values (
  '52000000-0000-0000-0000-000000000001',
  '53000000-0000-0000-0000-000000000001',
  'chips',
  'ended',
  timestamptz '2025-11-01 10:00+08',
  timestamptz '2025-11-01 10:05+08',
  timestamptz '2025-11-01 13:00+08',
  timestamptz '2025-11-01 13:00+08'
);

insert into game_players (
  game_id, player_id, seat, final_total, chip_1, chip_10, chip_50, chip_100
) values
  ('52000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'E', 0, 0, 40, 0, 0),
  ('52000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 'S', 0, 0, 40, 0, 0),
  ('52000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', 'W', 0, 0, 40, 0, 0),
  ('52000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004', 'N', 0, 0, 40, 0, 0);

insert into notable_claims (
  id, game_id, player_id, notable_hand_id, logged_by, created_at, photo_path
)
values (
  '51000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  (select id from notable_hands where name = 'Pure Suit'),
  '50000000-0000-0000-0000-000000000002',
  timestamptz '2025-11-01 12:00+08',
  '52000000-0000-0000-0000-000000000001/existing.webp'
);
