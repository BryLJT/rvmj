-- 0007 — chip-mode end by the counter (spec §8.6, revised 2026-08-27)
--
-- Replaces four-player confirmation. Conservation in propose_chip_counts already guaranteed the
-- arithmetic, so confirmation only ever guarded SEAT ATTRIBUTION — which four people reading one
-- seat-ordered list still guards. What goes is the requirement that each of them acknowledge it.
--
-- The finalize therefore moves from "the fourth confirmation" to "the player who entered the
-- counts", which is why the proposer has to be recorded at all. The four-second reading window
-- the other three get is deliberately CLIENT-side: the only caller who can reach this function is
-- the person who just typed the counts and decided the match was over, so the delay is an
-- ergonomic speed bump for a cooperating user, not a security boundary. Putting a clock check
-- here would buy nothing and would add clock-skew failure modes.

alter table games add column pending_proposed_by uuid references players(id);
comment on column games.pending_proposed_by is
  'chip mode: the player who entered pending_counts, and the only one who may end the match';

-- games.pending_confirmed is now VESTIGIAL and deliberately left in place. Dropping it would
-- force expire_game, reopen_game and 0002''s cleanup blocks to be re-issued, and their hardening
-- posture re-verified, for no behavioural gain. Nothing below writes it. A later migration with
-- independent reason to touch those functions should drop it.

-- ============ phase 1: propose, now attributed ============

-- The signature changes, so this is a drop and create rather than a replace. A new function
-- starts with a default ACL, which is why the grants at the foot of this file are not optional.
drop function if exists propose_chip_counts(uuid, jsonb);

create or replace function propose_chip_counts(p_game_id uuid, p_counts jsonb, p_player_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_seat text; v_sum int; r record;
begin
  perform 1 from games where id = p_game_id and status = 'active' and mode = 'chips' for update;
  if not found then raise exception 'game is not an active chip game'; end if;
  -- Attribution is a permission, so it is checked here rather than trusted from the caller:
  -- whoever this records becomes the only player who can end the match.
  perform 1 from game_players where game_id = p_game_id and player_id = p_player_id;
  if not found then raise exception 'player is not in this game'; end if;
  -- shape check: four seats, four non-negative integer counts each
  foreach v_seat in array array['E','S','W','N'] loop
    if p_counts->v_seat is null then raise exception 'missing counts for seat %', v_seat; end if;
    for r in select * from (values ('1'),('10'),('50'),('100')) as t(denom) loop
      if (p_counts->v_seat->>r.denom) is null or (p_counts->v_seat->>r.denom)::int < 0 then
        raise exception 'bad count for seat % denomination $%', v_seat, r.denom;
      end if;
    end loop;
  end loop;
  -- conservation backstop. Table totals mirror src/lib/chips.ts TABLE_QTY (40/36/16/4).
  -- The server action pre-checks with the TS checker and turns failures into a recount
  -- prompt; this raise should never fire in normal flow.
  for r in select * from (values ('1',40),('10',36),('50',16),('100',4)) as t(denom, expected) loop
    select sum((p_counts->s->>r.denom)::int) into v_sum
    from unnest(array['E','S','W','N']) as s;
    if v_sum <> r.expected then
      raise exception 'conservation failed: $% count is %, expected % — recount', r.denom, v_sum, r.expected;
    end if;
  end loop;
  -- Counts and their author land in ONE update. Nothing else in the schema writes pending_counts,
  -- so a proposal can never exist without the proposer that owns it.
  update games set pending_counts = p_counts, pending_proposed_by = p_player_id,
    last_activity_at = now()
  where id = p_game_id;
end $$;

-- ============ phase 2: the counter ends it ============

create or replace function end_chip_game(p_game_id uuid, p_player_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_game games%rowtype; v_seat text; v_stack int; v_zero int;
begin
  select * into v_game from games
  where id = p_game_id and status = 'active' and mode = 'chips' for update;
  if not found then raise exception 'game is not an active chip game'; end if;
  -- Order matters: "nothing to end" before "not yours to end". A reopened match has its counts
  -- cleared but keeps whatever pending_proposed_by the previous settlement left behind, and that
  -- leftover must read as inert rather than as a standing permission.
  if v_game.pending_counts is null then raise exception 'no counted result to end this match with'; end if;
  if v_game.pending_proposed_by is distinct from p_player_id then
    raise exception 'only the player who entered the counts can end the match';
  end if;
  -- finalize: write counts + derived totals for all four seats, one transaction
  foreach v_seat in array array['E','S','W','N'] loop
    v_stack := (v_game.pending_counts->v_seat->>'1')::int
             + 10  * (v_game.pending_counts->v_seat->>'10')::int
             + 50  * (v_game.pending_counts->v_seat->>'50')::int
             + 100 * (v_game.pending_counts->v_seat->>'100')::int;
    update game_players set
      chip_1   = (v_game.pending_counts->v_seat->>'1')::int,
      chip_10  = (v_game.pending_counts->v_seat->>'10')::int,
      chip_50  = (v_game.pending_counts->v_seat->>'50')::int,
      chip_100 = (v_game.pending_counts->v_seat->>'100')::int,
      final_total = v_stack - 400
    where game_id = p_game_id and seat = v_seat;
  end loop;
  -- should-never-happen backstop: conservation at propose time guarantees this sums to zero;
  -- if it does not, something bypassed propose_chip_counts. The caller alerts Telegram.
  select sum(final_total) into v_zero from game_players where game_id = p_game_id;
  if v_zero <> 0 then
    raise exception 'should-never-happen: chip finalize sums to % (expected 0)', v_zero;
  end if;
  update games set status = 'ended', ended_at = now(),
    pending_counts = null, pending_proposed_by = null
  where id = p_game_id;
  return 'ended';
end $$;

-- Removed, not left dormant. A surviving confirm_chip_result would still be callable by the
-- service role and would still finalize a match on a fourth confirmation, behind the app's back.
drop function if exists confirm_chip_result(uuid, uuid);

-- ============ hardening ============
-- 0004 is the ACL source of truth for objects that existed when it ran. Both functions below are
-- new to the catalog (one renamed, one re-signatured), so they carry their own grants.
revoke all privileges on function public.propose_chip_counts(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.propose_chip_counts(uuid, jsonb, uuid) to service_role, postgres;
revoke all privileges on function public.end_chip_game(uuid, uuid) from public, anon, authenticated;
grant execute on function public.end_chip_game(uuid, uuid) to service_role, postgres;
