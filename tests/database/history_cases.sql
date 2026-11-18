\set ON_ERROR_STOP on
create schema history_test;
create function history_test.assert_true(condition boolean, message text) returns void
language plpgsql as $$ begin if condition is not true then raise exception 'history assertion: %',message; end if; end $$;
create function history_test.refusal(sql text) returns text
language plpgsql as $$ begin execute sql; return '(no error)'; exception when others then return sqlerrm; end $$;
insert into auth.users(id,email,raw_user_meta_data)
select ('20200000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'history'||i||'@example.com',jsonb_build_object('full_name','History '||i) from generate_series(1,5) i;
insert into tables(id,code) values('20210000-0000-0000-0000-000000000001','HISTORY20'),('20210000-0000-0000-0000-000000000002','HISTORY21'),('20210000-0000-0000-0000-000000000003','HISTORY22');
insert into games(id,table_id,status,mode,variant,ended_at)
select ('20220000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'20210000-0000-0000-0000-000000000001','ended',case when i=1 then 'app' else 'chips' end,case when i%2=0 then 'fei' else 'regular' end,'2070-11-17T15:42:00Z' from generate_series(1,45) i;
insert into game_players(game_id,player_id,seat,final_total,chip_1,chip_10,chip_50,chip_100)
select g.id,('20200000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,(array['E','S','W','N'])[i],(array[42,-18,-24,0])[i],(array[42,2,6,0])[i],(array[0,3,2,0])[i],(array[0,1,1,0])[i],(array[4,3,3,4])[i]
from games g cross join generate_series(1,4) i where g.id::text like '20220000-%';
-- An ended game without this viewer, and every non-ended status, stay private to their scope.
insert into games(id,table_id,status,mode,ended_at)
select ('20230000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  -- The real one-open-game-per-table index stays: forming and active games each get their own table, and the ended-game table stays free for the reopen race.
  case i when 1 then '20210000-0000-0000-0000-000000000003' when 2 then '20210000-0000-0000-0000-000000000002' else '20210000-0000-0000-0000-000000000001' end::uuid,(array['forming','active','expired','quarantined','ended'])[i],'chips','2071-01-01Z' from generate_series(1,5) i;
insert into game_players(game_id,player_id,seat)
select id,'20200000-0000-0000-0000-000000000001','E' from games where id::text like '20230000-%' and status<>'ended';
create table history_test.before_players as select * from game_players where game_id::text like '20220000-%';
create table history_test.before_games as select * from games where id::text like '20220000-%';
select history_test.assert_true((select count(*)=21 from personal_game_history('20200000-0000-0000-0000-000000000001')),'bounded page');
select history_test.assert_true((select id='20220000-0000-0000-0000-000000000045' from personal_game_history('20200000-0000-0000-0000-000000000001') limit 1),'descending id breaks tied end times');
select history_test.assert_true((select count(*)=0 from personal_game_history('20200000-0000-0000-0000-000000000005')),'outsider reads no games');
select history_test.assert_true((select count(*)=21 from personal_game_history('20200000-0000-0000-0000-000000000001','2070-11-17T15:42:00Z','20220000-0000-0000-0000-000000000026')),'second batch excludes cursor and newer ties');
select history_test.assert_true((select count(*)=5 and bool_or(mode='app') and bool_or(variant='fei') from personal_game_history('20200000-0000-0000-0000-000000000001','2070-11-17T15:42:00Z','20220000-0000-0000-0000-000000000006')),'last batch includes both variants and app mode');
update games set ended_at='2072-01-01Z' where id='20220000-0000-0000-0000-000000000045';
select history_test.assert_true((select max(id::text)='20220000-0000-0000-0000-000000000025' from personal_game_history('20200000-0000-0000-0000-000000000001','2070-11-17T15:42:00Z','20220000-0000-0000-0000-000000000026')),'newly ended game does not repeat in old pagination');
update games set ended_at='2070-11-17T15:42:00Z' where id='20220000-0000-0000-0000-000000000045';
select * from save_historical_notable('20240000-0000-0000-0000-000000000001','20220000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000001',array(select id from notable_hands order by id limit 2));
select * from save_historical_notable('20240000-0000-0000-0000-000000000001','20220000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000001',array(select id from notable_hands order by id limit 2));
select * from save_historical_notable('20240000-0000-0000-0000-000000000002','20220000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000001',array(select id from notable_hands order by id limit 2));
select history_test.assert_true((select count(*)=2 from notable_claims where game_id='20220000-0000-0000-0000-000000000002'),'same retry is one claim; separate identical wins are allowed');
select history_test.assert_true((select count(*)=4 from notable_claim_types where claim_id::text like '20240000-%'),'each claim has every label');
select history_test.assert_true((select bool_and(created_at='2070-11-17T15:42:00Z' and logged_by='20200000-0000-0000-0000-000000000001') from notable_claims where id::text like '20240000-%'),'historical date and logger retained');
select history_test.assert_true(history_test.refusal($call$select * from save_historical_notable('20240000-0000-0000-0000-000000000003','20220000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000005',array(select id from notable_hands limit 1))$call$)='you did not play in this game','outsider logger');
select history_test.assert_true(history_test.refusal($call$select * from save_historical_notable('20240000-0000-0000-0000-000000000003','20220000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000005','20200000-0000-0000-0000-000000000001',array(select id from notable_hands limit 1))$call$)='winner did not play in this game','outsider winner');
select history_test.assert_true(history_test.refusal($call$select * from save_historical_notable('20240000-0000-0000-0000-000000000003','20220000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000001',array[(select id from notable_hands limit 1),'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid])$call$)='choose valid hand types','all labels must exist');
select history_test.assert_true(history_test.refusal($call$select * from save_historical_notable('20240000-0000-0000-0000-000000000003','20220000-0000-0000-0000-000000000001','20200000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000001',array(select id from notable_hands limit 1))$call$)='game is not an ended chip game','app game');
select history_test.assert_true(history_test.refusal($call$select * from save_historical_notable('20240000-0000-0000-0000-000000000001','20220000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000003','20200000-0000-0000-0000-000000000001',array(select id from notable_hands order by id limit 2))$call$)='save id belongs to a different win','mismatched retry');
select history_test.assert_true(not exists(select 1 from notable_claims where id='20240000-0000-0000-0000-000000000003'),'refused label/game writes are atomic');
select * from save_historical_notable('20240000-0000-0000-0000-000000000004','20220000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000001',array(select id from notable_hands limit 1),repeat('a',64),'jpg');
select finish_historical_photo('20240000-0000-0000-0000-000000000004','20200000-0000-0000-0000-000000000001');
select finish_historical_photo('20240000-0000-0000-0000-000000000004','20200000-0000-0000-0000-000000000001');
select history_test.assert_true((select photo_added_by='20200000-0000-0000-0000-000000000001' and photo_path='20220000-0000-0000-0000-000000000002/20240000-0000-0000-0000-000000000004-history.jpg' from notable_claims where id='20240000-0000-0000-0000-000000000004'),'photo replay keeps one path and contributor');
select clear_notable_photo('20240000-0000-0000-0000-000000000004','20200000-0000-0000-0000-000000000002');
select history_test.assert_true((select photo_complete from save_historical_notable('20240000-0000-0000-0000-000000000004','20220000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000002','20200000-0000-0000-0000-000000000001',array(select id from notable_hands limit 1),repeat('a',64),'jpg')),'completed retry does not resurrect removed photo');
select history_test.assert_true(not exists((select * from history_test.before_players except select * from game_players) union all (select * from game_players where game_id::text like '20220000-%' except select * from history_test.before_players)),'all player totals and chip counts unchanged');
select history_test.assert_true(not exists((select * from history_test.before_games except select * from games) union all (select * from games where id::text like '20220000-%' except select * from history_test.before_games)),'all game fields including end time unchanged');
-- Leave these fixtures for deterministic lock races in the shell harness.
