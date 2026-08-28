# RVMJ Standings and Multi-Label Notable Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three clearly named, academic-year-aware standings views and let one physical notable win carry several hand-type labels while remaining one ranked win, one live entry, and one gallery card.

**Architecture:** Keep `notable_claims` as the durable win and add a normalized `notable_claim_types` join table. Migration `0011` backfills existing wins and adds a new atomic multi-label save RPC while retaining and upgrading the old single-label RPC. Migration `0012` adds server-only parameterized query functions for each player's latest-20 completed-game average and the ordered individual-win ranking. The Next.js homepage remains a Server Component driven by URL state; the active-game logger stays the only new interactive selection surface.

**Tech Stack:** Next.js 16.3 App Router, React 19.2, TypeScript 5, Supabase Postgres/RLS/Realtime/Storage, Tailwind CSS 4, Vitest 4 + Testing Library, Bash/PostgreSQL migration harness

**Spec:** `docs/superpowers/specs/2026-08-28-standings-and-multi-label-notable-wins-design.md`

## Global Constraints

- No hosted Supabase mutation, GitHub push, merge, or production deploy during local implementation. Database application and application deployment are separate Bryan approval gates.
- Keep the route keys `lifetime`, `form`, and `skill` for bookmark compatibility; only the visible labels become **Total score**, **Pts per game**, and **Notable wins**.
- The current NUS academic year remains the default once it has a completed game. Before its first completed game, retain the existing All time fallback. Do not reopen this product decision.
- One academic-year selector controls all three tabs. A tab or year switch preserves valid `hand` filters; only Notable wins consumes them.
- Pts per game averages each player's own newest 20 completed games inside the selected period. All time removes only the year boundary, never the 20-game cap.
- One `notable_claims` row is one physical win. Multiple labels never create multiple claims, live entries, ranking rows, or gallery cards.
- With no selected filters, order notable wins by total label count descending, created time descending, then claim ID ascending. With filters, require at least one match and prepend selected-label match count descending.
- Preserve the old `notable_claims.notable_hand_id`, `log_notable_claim`, and `skill_board` through this release. Contract cleanup is a separate future migration.
- During the compatibility window, `notable_claims.notable_hand_id` stores the alphabetically first valid selected hand type.
- Browser roles may read `notable_claim_types` only through RLS and may never write it. All three new RPCs are server-only. Keep every function's `search_path` pinned.
- Preserve current photo preparation, one-photo maximum, pre-save replacement/removal, upload-failure no-photo escape, uploaded-object cleanup, signing, and logger-only post-save removal.
- Use `Asia/Singapore` for academic-year filing and displayed win dates.
- Do not add a dependency. Use TDD for every behavior change: add one failing test, observe the intended failure, implement the minimum, rerun green, and commit exact paths only.
- Before changing Next.js files, reread `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`, `.../02-components/link.md`, and `.../01-getting-started/05-server-and-client-components.md` as required by `AGENTS.md`.

## File Map

| File | Responsibility |
|---|---|
| `supabase/migrations/0011_multi_label_notable_wins.sql` | Join table, backfill, compatible old RPC, atomic new RPC, RLS, grants, assertions. |
| `supabase/migrations/0012_standings_queries.sql` | Server-only Pts-per-game and individual notable-win query functions. |
| `tests/database/standings_before_0011.sql` | Existing single-label/photo fixture inserted before migration 0011. |
| `tests/database/standings_cases.sql` | Backfill, atomic save, compatibility, access, PPG window, period, and ranking behavior. |
| `tests/database/run-migrations.sh` | Replay 0011/0012 on every current database shape and run the non-vacuous standings shape. |
| `tests/database/verify_migrations.sql` | Final object, ACL, RLS, function, and compatibility contract. |
| `src/lib/actions/game.ts` | Deduplicate selected IDs, retain photo guarantees, call `log_notable_win`. |
| `tests/actions/game.test.ts` | Multi-label server-boundary and photo cleanup behavior. |
| `src/app/game/[id]/page.tsx` | Include rarity in the catalogue read. |
| `src/app/game/[id]/NotableLogger.tsx` | Inline rarity-grouped multi-select logger. |
| `tests/components/NotableLogger.test.tsx` | Selection, grouping, submit, failure retention, and photo regression coverage. |
| `src/app/game/[id]/ChipLive.tsx` | Read attached label rows and render one entry per win. |
| `tests/components/ChipLive.test.tsx` | Multi-label one-entry rendering and fail-closed read behavior. |
| `src/app/hands/page.tsx` | Fetch all labels for each photographed win. |
| `src/app/hands/HandsGallery.tsx` | Render all labels on one card/dialog per win. |
| `tests/pages/hands-page.test.ts`, `tests/components/HandsGallery.test.tsx` | Gallery query, identity, labels, access, and removal regressions. |
| `src/lib/standings.ts` | Board keys, filter normalization, stable URL construction, score/date formatting. |
| `tests/standings.test.ts` | Pure URL, filter, PPG, and Singapore-date contracts. |
| `src/components/YearPills.tsx` | Shared year links that preserve board and valid hand filters. |
| `tests/components/YearPills.test.tsx` | Shared-link and explicit-All-time behavior. |
| `src/components/HandTypeFilter.tsx` | Server-rendered GET filter panel, selected chips, remove, and clear-all links. |
| `tests/components/HandTypeFilter.test.tsx` | Multi-select form and recoverable URL behavior. |
| `src/components/NotableWinRow.tsx` | One accessible ranked individual-win presentation. |
| `tests/components/NotableWinRow.test.tsx` | Winner, date, all labels, count, and rank. |
| `src/app/page.tsx` | Shared period resolution, exact tab labels, two RPC reads, and three board renderers. |
| `tests/components/HomeBoards.test.tsx` | Whole homepage query routing, tab/year persistence, PPG copy, filtering, and failure states. |

---

### Task 1: Add Multi-Label Storage Without Breaking the Deployed App

**Files:**
- Create: `supabase/migrations/0011_multi_label_notable_wins.sql`
- Create: `tests/database/standings_before_0011.sql`
- Create: `tests/database/standings_cases.sql`
- Modify: `tests/database/run-migrations.sh`
- Modify: `tests/database/verify_migrations.sql`

**Interfaces:**
- New relation: `notable_claim_types(claim_id uuid, notable_hand_id uuid)`
- New RPC: `log_notable_win(uuid, uuid, uuid[], uuid, text) returns uuid`
- Compatible RPC retained: `log_notable_claim(uuid, uuid, uuid, uuid, text) returns uuid`

- [ ] **Step 1: Add a non-vacuous pre-migration fixture**

Create `tests/database/standings_before_0011.sql`. Insert four auth users, one table, one completed chip game, four `game_players` totals, and one `notable_claims` row with a non-null `photo_path`. Use fixed UUIDs and capture the catalogue ID with a subquery by `name = 'Pure Suit'`. This file runs after 0010 and before 0011, so it proves a real hosted-style row is converted rather than merely proving an empty backfill succeeds.

The important claim insert is:

```sql
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
```

- [ ] **Step 2: Wire the failing replay first**

In `tests/database/run-migrations.sh`:

1. Add `apply <database> 0011_multi_label_notable_wins.sql` after 0010 in every full-stack database block.
2. Add a dedicated `rvmj_standings` database that applies 0001–0010, runs `standings_before_0011.sql`, applies 0011, runs `verify_migrations.sql`, then runs the Task 1 sections of `standings_cases.sql`.
3. Leave the clean replay coverage guard unchanged; it must discover every new migration as each task adds it.

Run:

```bash
bash tests/database/run-migrations.sh
```

Expected: FAIL because migration 0011 and the standings case files do not exist yet. The failure proves the harness will not silently omit this schema release.

- [ ] **Step 3: Write the join-table and save-path migration**

Create `supabase/migrations/0011_multi_label_notable_wins.sql` with this transaction structure:

```sql
begin;

create table public.notable_claim_types (
  claim_id uuid not null references public.notable_claims(id) on delete cascade,
  notable_hand_id uuid not null references public.notable_hands(id),
  primary key (claim_id, notable_hand_id)
);
create index notable_claim_types_by_hand
  on public.notable_claim_types (notable_hand_id, claim_id);

insert into public.notable_claim_types (claim_id, notable_hand_id)
select id, notable_hand_id from public.notable_claims;

do $$
begin
  if (select count(*) from public.notable_claims)
     <> (select count(distinct claim_id) from public.notable_claim_types) then
    raise exception 'not every existing notable win was backfilled';
  end if;
  if exists (
    select claim_id from public.notable_claim_types
    group by claim_id having count(*) <> 1
  ) then
    raise exception 'an existing notable win did not receive exactly one label';
  end if;
end $$;

create function public.log_notable_win(
  p_game_id uuid,
  p_player_id uuid,
  p_notable_hand_ids uuid[],
  p_logged_by uuid,
  p_photo_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_hand_ids uuid[];
begin
  perform 1 from games
  where id = p_game_id and status = 'active' and mode = 'chips'
  for update;
  if not found then raise exception 'game is not an active chip game'; end if;

  perform 1 from game_players where game_id = p_game_id and player_id = p_player_id;
  if not found then raise exception 'claimed player is not in this game'; end if;
  perform 1 from game_players where game_id = p_game_id and player_id = p_logged_by;
  if not found then raise exception 'logger is not in this game'; end if;

  select array_agg(h.id order by h.name, h.id) into v_hand_ids
  from (
    select distinct requested.id
    from unnest(coalesce(p_notable_hand_ids, array[]::uuid[])) requested(id)
  ) requested
  join notable_hands h on h.id = requested.id;

  if coalesce(cardinality(v_hand_ids), 0) = 0 then
    raise exception 'choose at least one valid hand type';
  end if;

  insert into notable_claims (
    game_id, player_id, notable_hand_id, logged_by, photo_path
  ) values (
    p_game_id, p_player_id, v_hand_ids[1], p_logged_by, p_photo_path
  ) returning id into v_id;

  insert into notable_claim_types (claim_id, notable_hand_id)
  select v_id, unnest(v_hand_ids);

  update games set last_activity_at = now() where id = p_game_id;
  return v_id;
end $$;

create or replace function public.log_notable_claim(
  p_game_id uuid,
  p_player_id uuid,
  p_notable_hand_id uuid,
  p_logged_by uuid,
  p_photo_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return log_notable_win(
    p_game_id,
    p_player_id,
    array[p_notable_hand_id],
    p_logged_by,
    p_photo_path
  );
end $$;

alter table public.notable_claim_types enable row level security;
create policy "game participants read notable claim types"
  on public.notable_claim_types for select to authenticated
  using (
    exists (
      select 1
      from public.notable_claims nc
      join public.game_players gp on gp.game_id = nc.game_id
      where nc.id = notable_claim_types.claim_id
        and gp.player_id = auth.uid()
    )
  );

revoke all on public.notable_claim_types from public, anon, authenticated;
grant select on public.notable_claim_types to authenticated;
grant all privileges on public.notable_claim_types to service_role;

revoke all privileges on function public.log_notable_win(uuid, uuid, uuid[], uuid, text)
  from public, anon, authenticated;
grant execute on function public.log_notable_win(uuid, uuid, uuid[], uuid, text)
  to service_role, postgres;
revoke all privileges on function public.log_notable_claim(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.log_notable_claim(uuid, uuid, uuid, uuid, text)
  to service_role, postgres;

commit;
```

Add assertion blocks before `commit` for: RLS enabled; exactly one participant-read policy; no browser write privilege; authenticated SELECT present; service-role full table access; neither browser role can execute either save function; service role can execute both; both functions retain `security definer` and `search_path=public`.

- [ ] **Step 4: Add behavioral cases for conversion and both save paths**

In `tests/database/standings_cases.sql`, assert:

- The pre-0011 claim ID, game, winner, logger, `created_at`, and `photo_path` are unchanged.
- It has exactly one joined type, equal to its legacy `notable_hand_id`.
- Calling old `log_notable_claim` on an active chip game creates one claim and one joined label.
- Calling `log_notable_win` with Pure Suit, All Pungs, and a repeated Pure Suit creates one claim and exactly two connections.
- The legacy column on that new claim points to All Pungs because `All Pungs` sorts before `Pure Suit`.
- Empty and all-invalid type arrays are rejected.
- A forced label-insert failure rolls the claim back. Use a transaction-local trigger on `notable_claim_types` that raises, catch the RPC error in a `do` block, and assert the claim count did not change.
- Deleting a disposable claim cascades its connections.
- The legacy `skill_board` still counts claims, not label rows.

- [ ] **Step 5: Extend the standing final-contract verifier**

Update `tests/database/verify_migrations.sql` so its exhaustive readable-table set includes `notable_claim_types`, its protected-function set includes `log_notable_win`, and it explicitly proves:

```sql
select test_support.assert_true(
  (select relrowsecurity from pg_class where oid = 'public.notable_claim_types'::regclass),
  'notable_claim_types keeps RLS enabled'
);

select test_support.assert_true(
  not has_table_privilege('authenticated', 'public.notable_claim_types',
    'insert,update,delete,truncate,references,trigger'),
  'authenticated cannot write notable_claim_types'
);
```

Do not change the old `skill_board` allowlist or remove the old RPC from verification.

- [ ] **Step 6: Run the database save/backfill slice GREEN**

```bash
bash tests/database/run-migrations.sh
```

Expected: PASS. Migration 0011 applies on every shape; the hosted-style existing row is unchanged and backfilled; both old and new RPCs work; duplicate labels collapse; ACL/RLS assertions pass.

- [ ] **Step 7: Commit the storage contract**

```bash
git add supabase/migrations/0011_multi_label_notable_wins.sql tests/database/standings_before_0011.sql tests/database/standings_cases.sql tests/database/run-migrations.sh tests/database/verify_migrations.sql
git commit -m "feat(db): store multiple labels on one notable win"
```

---

### Task 2: Add the Two Server-Only Standings Queries

**Files:**
- Create: `supabase/migrations/0012_standings_queries.sql`
- Modify: `tests/database/standings_cases.sql`
- Modify: `tests/database/run-migrations.sh`
- Modify: `tests/database/verify_migrations.sql`

**Interfaces:**
- `points_per_game_board(p_academic_year int default null)`
- `notable_wins_board(p_academic_year int default null, p_hand_ids uuid[] default '{}')`

- [ ] **Step 1: Add failing query fixtures and assertions**

First add `apply <database> 0012_standings_queries.sql` immediately after 0011 in every full-stack block of `tests/database/run-migrations.sh`, including `rvmj_standings`. Then extend `tests/database/standings_cases.sql` with completed games that cover:

- Different players having 1, 19, 20, and 21 eligible games.
- A 21st older game with an extreme score that would visibly corrupt the average if the cap failed.
- Identical `ended_at` values whose game UUIDs decide the last included game.
- Games on both sides of the first-Monday Singapore boundary.
- Three notable wins with 1, 2, and 3 labels, two sharing a timestamp.
- A selected set where one win matches three, another two, another one, and another zero.

Assert exact row order through `array_agg(... order by ordinality)` over each function call. Assert All time with `null`, a specific academic year, duplicate filter IDs, an unknown-but-valid UUID, and an empty filter array.

Run:

```bash
bash tests/database/run-migrations.sh
```

Expected: FAIL because `0012_standings_queries.sql` does not exist. After creating an empty transactional 0012 file solely to expose the test failure, run again and expect failure because `points_per_game_board` and `notable_wins_board` do not exist. Replace that empty transaction in Step 2; never commit it.

- [ ] **Step 2: Implement Pts per game in SQL**

Create `supabase/migrations/0012_standings_queries.sql` and begin a transaction. Add:

```sql
create function public.points_per_game_board(p_academic_year int default null)
returns table (
  id uuid,
  display_name text,
  house text,
  avg_points numeric,
  games_counted bigint
)
language sql stable security invoker set search_path = public as $$
  with ranked as (
    select
      gp.player_id,
      gp.final_total,
      row_number() over (
        partition by gp.player_id
        order by g.ended_at desc, g.id desc
      ) as recency
    from game_players gp
    join games g on g.id = gp.game_id
    where g.status = 'ended'
      and gp.final_total is not null
      and (
        p_academic_year is null
        or academic_year_of(g.ended_at) = p_academic_year
      )
  ), recent as (
    select * from ranked where recency <= 20
  )
  select
    p.id,
    p.display_name,
    p.house,
    avg(recent.final_total)::numeric as avg_points,
    count(*)::bigint as games_counted
  from recent
  join players p on p.id = recent.player_id
  group by p.id, p.display_name, p.house
  order by avg(recent.final_total) desc, count(*) desc, p.display_name asc, p.id asc
$$;
```

The function returns the exact average; the application alone rounds display to one decimal. Ranking must not tie values merely because their rendered strings round the same way.

- [ ] **Step 3: Implement individual notable-win ranking in SQL**

In the same migration add:

```sql
create function public.notable_wins_board(
  p_academic_year int default null,
  p_hand_ids uuid[] default array[]::uuid[]
) returns table (
  claim_id uuid,
  player_id uuid,
  display_name text,
  house text,
  created_at timestamptz,
  hand_types jsonb,
  total_label_count bigint,
  selected_match_count bigint
)
language sql stable security invoker set search_path = public as $$
  with selected as (
    select distinct h.id
    from unnest(coalesce(p_hand_ids, array[]::uuid[])) requested(id)
    join notable_hands h on h.id = requested.id
  ), selection as (
    select count(*)::bigint as filter_count from selected
  ), labels as (
    select
      nct.claim_id,
      jsonb_agg(
        jsonb_build_object(
          'id', h.id,
          'name', h.name,
          'local_name', h.local_name,
          'rarity', h.rarity
        ) order by h.name, h.id
      ) as hand_types,
      count(*)::bigint as total_label_count,
      count(selected.id)::bigint as selected_match_count
    from notable_claim_types nct
    join notable_hands h on h.id = nct.notable_hand_id
    left join selected on selected.id = nct.notable_hand_id
    group by nct.claim_id
  )
  select
    nc.id as claim_id,
    p.id as player_id,
    p.display_name,
    p.house,
    nc.created_at,
    labels.hand_types,
    labels.total_label_count,
    labels.selected_match_count
  from notable_claims nc
  join labels on labels.claim_id = nc.id
  join games g on g.id = nc.game_id and g.status = 'ended'
  join players p on p.id = nc.player_id
  cross join selection
  where (
    p_academic_year is null
    or academic_year_of(g.ended_at) = p_academic_year
  )
    and (selection.filter_count = 0 or labels.selected_match_count > 0)
  order by
    case when selection.filter_count > 0 then labels.selected_match_count else 0 end desc,
    labels.total_label_count desc,
    nc.created_at desc,
    nc.id asc
$$;
```

This query deliberately uses the game's `ended_at` for the period and the win's `created_at` only for the approved recency tie-break.

- [ ] **Step 4: Harden both query functions**

Before `commit`:

```sql
revoke all privileges on function public.points_per_game_board(int)
  from public, anon, authenticated;
grant execute on function public.points_per_game_board(int)
  to service_role, postgres;

revoke all privileges on function public.notable_wins_board(int, uuid[])
  from public, anon, authenticated;
grant execute on function public.notable_wins_board(int, uuid[])
  to service_role, postgres;
```

Add positive and negative ACL assertions, `security_invoker` assertions, and pinned-search-path assertions, then `commit`. Add both functions to the final verifier's protected-function set.

- [ ] **Step 5: Run the full database harness GREEN**

```bash
bash tests/database/run-migrations.sh
```

Expected: PASS across every existing database shape and the new non-vacuous standings shape. PPG windows are per player; filters use match-any eligibility and most-selected-matches-first ordering; the old deployed contracts remain readable.

- [ ] **Step 6: Commit the query contract**

```bash
git add supabase/migrations/0012_standings_queries.sql tests/database/standings_cases.sql tests/database/run-migrations.sh tests/database/verify_migrations.sql
git commit -m "feat(db): query rolling points and ranked notable wins"
```

---

### Task 3: Send One Deduplicated Multi-Label Win Through the Server Boundary

**Files:**
- Modify: `tests/actions/game.test.ts`
- Modify: `src/lib/actions/game.ts`

**Interface:**

```ts
logNotable(
  gameId: string,
  playerId: string,
  notableHandIds: string[],
  photo?: Blob,
): Promise<{ error?: string; photoFailed?: boolean }>
```

- [ ] **Step 1: Change tests to the array contract and add boundary cases**

Update every `logNotable` call and expectation to pass `[HAND_ID]`. Add tests that prove:

```ts
it('deduplicates selected hand ids before calling the multi-label RPC', async () => {
  const { rpc } = arrangeNotable();

  expect(await logNotable(GAME_ID, OTHER_ID, [HAND_ID, SECOND_HAND_ID, HAND_ID])).toEqual({});

  expect(rpc).toHaveBeenCalledWith('log_notable_win', expect.objectContaining({
    p_notable_hand_ids: [HAND_ID, SECOND_HAND_ID],
  }));
});

it('rejects no selected hand types before uploading a photo', async () => {
  const { upload, rpc } = arrangeNotable();

  expect(await logNotable(GAME_ID, OTHER_ID, [], new Blob([webpBytes()]))).toEqual({
    error: 'Choose at least one hand type.',
  });
  expect(upload).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
```

Keep every existing WebP/JPEG, size, byte-signature, participant, claim-refusal, and orphan-cleanup test.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/actions/game.test.ts
```

Expected: FAIL on the signature/RPC name and deduplication expectations.

- [ ] **Step 3: Implement the narrow action change**

At the start of `logNotable`, after participation is confirmed but before any photo bytes are read:

```ts
const handIds = Array.isArray(notableHandIds)
  ? [...new Set(notableHandIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  : [];
if (handIds.length === 0) return { error: 'Choose at least one hand type.' };
```

Replace only the RPC call:

```ts
const { error } = await admin.rpc('log_notable_win', {
  p_game_id: gameId,
  p_player_id: playerId,
  p_notable_hand_ids: handIds,
  p_logged_by: user.id,
  p_photo_path: path,
});
```

Do not alter upload ordering or cleanup. Database catalogue validation remains the final authority.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx vitest run tests/actions/game.test.ts
git add src/lib/actions/game.ts tests/actions/game.test.ts
git commit -m "feat: log one notable win with multiple labels"
```

---

### Task 4: Replace the Single Select With the Approved Inline Logger

**Files:**
- Modify: `src/app/game/[id]/page.tsx`
- Modify: `src/app/game/[id]/GameLive.tsx`
- Modify: `src/app/game/[id]/NotableLogger.tsx`
- Modify: `tests/components/NotableLogger.test.tsx`

- [ ] **Step 1: Write the multi-select UI tests**

Give every test hand a `rarity: 'uncommon' | 'rare' | 'legendary'`. Replace the old select helper with checkbox clicks. Add coverage that:

- The dialog and action are named `Log notable win`.
- Uncommon, Rare, and Legendary headings appear in that order.
- All 12 named checkbox controls are present inline.
- One winner plus zero labels stays disabled.
- One winner plus one or several labels enables the action.
- The action receives the full selected ID array once.
- A second click deselects one label without changing the winner or other labels.
- Upload failure, thrown request, and Log it without the photo retain the exact selected label set.

The core call expectation becomes:

```ts
expect(logNotable).toHaveBeenCalledWith('g1', 'p2', ['h1', 'h8'], undefined);
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/components/NotableLogger.test.tsx
```

Expected: FAIL because the current component exposes one `<select>` and the old copy.

- [ ] **Step 3: Include rarity in the catalogue contract**

In `src/app/game/[id]/page.tsx` read:

```ts
const { data: notableHands } = await supabase
  .from('notable_hands')
  .select('id, name, local_name, rarity')
  .order('name');
```

Update the catalogue prop types in `GameLive.tsx`, `ChipLive.tsx`, and `NotableLogger.tsx` to use:

```ts
type NotableHand = {
  id: string;
  name: string;
  local_name: string | null;
  rarity: 'uncommon' | 'rare' | 'legendary';
};
```

- [ ] **Step 4: Implement rarity-grouped checkbox controls**

Replace `handId` with `selectedHandIds: string[]`. Render three fieldsets in this exact order:

```ts
const RARITIES = [
  ['uncommon', 'Uncommon'],
  ['rare', 'Rare'],
  ['legendary', 'Legendary'],
] as const;

const toggleHand = (id: string) => {
  setSelectedHandIds((current) =>
    current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
  );
};
```

Use real checkbox inputs with a minimum 44px label target. The submit guard is:

```ts
if (
  submittingRef.current
  || preparingPhotoRef.current
  || isSyncBlocked?.()
  || !playerId
  || selectedHandIds.length === 0
) return;
```

Call `logNotable(gameId, playerId, selectedHandIds, ...)`. Rename the panel, button, busy label, and active-game launcher to `Log notable win` / `Logging…`.

- [ ] **Step 5: Run logger and nearby page tests GREEN**

```bash
npx vitest run tests/components/NotableLogger.test.tsx tests/components/ChipLive.test.tsx tests/components/AppStates.test.tsx
```

Expected: PASS; photo lifecycle and sync-blocking behavior remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/app/game/[id]/page.tsx src/app/game/[id]/GameLive.tsx src/app/game/[id]/NotableLogger.tsx src/app/game/[id]/ChipLive.tsx tests/components/NotableLogger.test.tsx tests/components/ChipLive.test.tsx tests/components/AppStates.test.tsx
git commit -m "feat: choose multiple labels for a notable win"
```

---

### Task 5: Render Every Label Once in the Live Match

**Files:**
- Modify: `src/app/game/[id]/ChipLive.tsx`
- Modify: `tests/components/ChipLive.test.tsx`

- [ ] **Step 1: Add the failing one-row/many-label test**

Use this claim shape in the test fixture:

```ts
db.claims = [{
  id: 'c1',
  player_id: 'p2',
  photo_path: null,
  notable_claim_types: [
    { notable_hand_id: 'h1' },
    { notable_hand_id: 'h8' },
  ],
}];
```

Assert `Bryan` appears in exactly one notable-win list item and both label names appear inside it. Add a query-contract assertion that the nested relation is selected. Keep the existing failed-claims-read test; an unreadable join must fail closed, not silently display a partial label set.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/components/ChipLive.test.tsx
```

Expected: FAIL because the live component reads `notable_hand_id` from the parent row.

- [ ] **Step 3: Read and render the normalized relation**

Change the query to:

```ts
const { data: claimRows, error: claimsError } = await supabase
  .from('notable_claims')
  .select('id, player_id, photo_path, notable_claim_types(notable_hand_id)')
  .eq('game_id', gameId)
  .order('created_at');
```

Use this shape:

```ts
type Claim = {
  id: string;
  player_id: string;
  photo_path: string | null;
  notable_claim_types: { notable_hand_id: string }[];
};
```

Map the child IDs to catalogue names, sort names alphabetically for stable rendering, and render them within the same `<li key={claim.id}>`. Use the joined names in the thumbnail alt text. Do not subscribe to child-table changes: the only write is atomic with the parent insert, and the existing parent Realtime event reloads after commit.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx vitest run tests/components/ChipLive.test.tsx
git add src/app/game/[id]/ChipLive.tsx tests/components/ChipLive.test.tsx
git commit -m "feat: show all labels on a live notable win"
```

---

### Task 6: Keep the Gallery One Card per Win and Show All Labels

**Files:**
- Modify: `src/app/hands/page.tsx`
- Modify: `src/app/hands/HandsGallery.tsx`
- Modify: `tests/pages/hands-page.test.ts`
- Modify: `tests/components/HandsGallery.test.tsx`

- [ ] **Step 1: Write failing gallery tests**

Replace `handName` with `handNames: string[]` in the photo fixture. Add a card with `['All Pungs', 'Pure Suit']` and assert:

- One button/card renders for one claim.
- Both labels render on the card and full-screen panel.
- The accessible name includes both labels and the winner.
- Removing the photo still calls `removeNotablePhoto` exactly once with the parent claim ID.
- `/hands` queries `notable_claim_types(notable_hands(name))`, not the legacy parent relationship.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/components/HandsGallery.test.tsx tests/pages/hands-page.test.ts
```

Expected: FAIL on the old singular `handName` shape and query.

- [ ] **Step 3: Change the archive query and DTO**

In `src/app/hands/page.tsx` select:

```ts
.select(`
  id,
  created_at,
  photo_path,
  logged_by,
  players!notable_claims_player_id_fkey(display_name),
  notable_claim_types(notable_hands(name))
`)
```

Map every joined name, remove missing joins, sort alphabetically, and emit:

```ts
export type HandPhoto = {
  claimId: string;
  url: string;
  playerName: string;
  handNames: string[];
  playedAt: string;
  mine: boolean;
};
```

The page continues to query only rows with `photo_path is not null`, sort newest first, sign paths in one batch, and drop only paths that fail to sign.

- [ ] **Step 4: Render all labels without multiplying cards**

In `HandsGallery`, use `item.handNames.join(', ')` for accessible photo/dialog names and render each label as its own compact text row or chip. Keep `claimId` as the card key and removal target. Keep the Singapore grouping helper unchanged.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx vitest run tests/components/HandsGallery.test.tsx tests/pages/hands-page.test.ts
git add src/app/hands/page.tsx src/app/hands/HandsGallery.tsx tests/pages/hands-page.test.ts tests/components/HandsGallery.test.tsx
git commit -m "feat: show every label in the hand gallery"
```

---

### Task 7: Make Standings URL State Explicit and Shared

**Files:**
- Create: `src/lib/standings.ts`
- Create: `tests/standings.test.ts`
- Modify: `src/components/YearPills.tsx`
- Modify: `tests/components/YearPills.test.tsx`

**URL contract:** repeated `hand` values, for example `/?board=skill&year=2026&hand=<id-a>&hand=<id-b>`.

- [ ] **Step 1: Reread the three repository-pinned Next.js guides**

Confirm that page `searchParams` is a Promise, repeated keys arrive as `string[]`, `Link` remains the primary client-navigation primitive, and non-interactive URL composition stays on the server.

- [ ] **Step 2: Write failing pure URL/filter tests**

Cover:

```ts
normalizeBoard('skill') === 'skill'
normalizeBoard(['skill', 'form']) === 'lifetime'
normalizeHandFilters(['valid-b', 'bad', 'valid-a', 'valid-a'], allowed)
  === ['valid-a', 'valid-b']
standingsHref({ board: 'form', year: 2026, handIds: ['b', 'a', 'a'] })
  === '/?board=form&year=2026&hand=a&hand=b'
```

Also cover All time, missing filters, malformed scalar/array input, signed one-decimal PPG formatting, and a Singapore date whose UTC calendar date differs.

- [ ] **Step 3: Run RED**

```bash
npx vitest run tests/standings.test.ts
```

Expected: FAIL because `src/lib/standings.ts` does not exist.

- [ ] **Step 4: Implement the pure contract**

Export:

```ts
export const BOARDS = {
  lifetime: { title: 'Total score' },
  form: { title: 'Pts per game' },
  skill: { title: 'Notable wins' },
} as const;

export type BoardKey = keyof typeof BOARDS;
export type YearSelection = number | 'all';

export function normalizeBoard(raw: string | string[] | undefined): BoardKey;
export function normalizeHandFilters(
  raw: string | string[] | undefined,
  allowedIds: ReadonlySet<string>,
): string[];
export function standingsHref(input: {
  board: BoardKey;
  year: YearSelection;
  handIds?: readonly string[];
}): string;
export function formatPointsPerGame(value: number): string;
export function formatSingaporeWinDate(value: string): string;
```

`standingsHref` deduplicates and sorts hand IDs before appending repeated `hand` keys. `formatPointsPerGame` returns `+8.5`, `0.0`, or `-3.2`. The date formatter pins `timeZone: 'Asia/Singapore'`.

- [ ] **Step 5: Generalize YearPills**

Change its props to:

```ts
{
  years: number[];
  selected: YearSelection;
  board: BoardKey;
  handIds: string[];
}
```

Build every link with `standingsHref`, including explicit All time. Preserve the horizontal scrolling, 44px targets, and `aria-current` behavior.

- [ ] **Step 6: Run GREEN and commit**

```bash
npx vitest run tests/standings.test.ts tests/components/YearPills.test.tsx
git add src/lib/standings.ts tests/standings.test.ts src/components/YearPills.tsx tests/components/YearPills.test.tsx
git commit -m "refactor: share standings URL and period state"
```

---

### Task 8: Ship the Exact Tab Labels and Pts per Game Board

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `tests/components/HomeBoards.test.tsx`

- [ ] **Step 1: Rewrite the homepage test recorder for RPCs**

Keep table-read recording for `academic_years`, `lifetime_board`, `lifetime_board_by_year`, `players`, and `notable_hands`. Add an RPC recorder shaped as:

```ts
rpcCalls: [] as { name: string; args: Record<string, unknown> }[]
```

Add failing tests for:

- Exact tab labels and unchanged internal href keys.
- Academic-year pills appearing on all three boards.
- Tab switches preserving explicit year and valid hand filters.
- `form` calling `points_per_game_board` with `p_academic_year: null` for All time and an integer for a year.
- One game showing `1 game counted`; 19 showing `19 games counted`; 20 showing `Latest 20 games`.
- `+8.5`, `0.0`, and `-3.2` display and corresponding gain/neutral/loss tone.
- No app-mode explanation anywhere.
- A failed PPG RPC rendering `Couldn’t load this board` rather than an empty board.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/components/HomeBoards.test.tsx
```

Expected: FAIL on old labels, year visibility, placeholder copy, and absent RPC.

- [ ] **Step 3: Make the period and filter catalogue reads shared**

In `Home`, type search params as:

```ts
Promise<{
  board?: string | string[];
  year?: string | string[];
  hand?: string | string[];
}>
```

Read `academic_years` and the 12-row `notable_hands` catalogue for every board, in parallel with the user read. The catalogue read is shared because a player may switch away from Notable wins and back; valid hand filters must survive those intermediate tab URLs even though the other two queries ignore them. Build an allowed-ID set and call `normalizeHandFilters` before constructing any link.

Narrow the year request before calling the existing parser:

```ts
const requestedYear = parseYearParam(typeof rawYear === 'string' ? rawYear : undefined);
```

Resolve `selectedYear` once using the existing `academicYearOf(new Date())` logic. Preserve the exact empty-current-year fallback.

- [ ] **Step 4: Route Total score and Pts per game queries**

Use `BOARDS` and `normalizeBoard` from `src/lib/standings.ts`. Keep Total score on the existing views. For Pts per game call:

```ts
createAdminClient().rpc('points_per_game_board', {
  p_academic_year: selectedYear === 'all' ? null : selectedYear,
});
```

Render PPG rows with `BoardRow`; use the exact contexts and `formatPointsPerGame`. Render `YearPills` below the tabs for every board.

- [ ] **Step 5: Preserve state in tab links**

Every tab uses:

```tsx
href={standingsHref({ board: key, year: selectedYear, handIds: selectedHandIds })}
```

Keep `prefetch` and `aria-current`. The filter values remain in the URL on Total score and Pts per game but do not affect their queries.

- [ ] **Step 6: Run GREEN and commit**

```bash
npx vitest run tests/components/HomeBoards.test.tsx tests/components/YearPills.test.tsx tests/standings.test.ts
git add src/app/page.tsx tests/components/HomeBoards.test.tsx
git commit -m "feat: add shared-year points-per-game standings"
```

---

### Task 9: Render and Filter the Individual Notable-Win Ranking

**Files:**
- Create: `src/components/HandTypeFilter.tsx`
- Create: `tests/components/HandTypeFilter.test.tsx`
- Create: `src/components/NotableWinRow.tsx`
- Create: `tests/components/NotableWinRow.test.tsx`
- Modify: `src/app/page.tsx`
- Modify: `tests/components/HomeBoards.test.tsx`

- [ ] **Step 1: Write focused component tests**

`HandTypeFilter` tests must prove:

- `Filter hand types` controls a dedicated panel.
- All 12 types are grouped Uncommon, Rare, Legendary.
- Checked controls submit repeated `hand` fields through a GET form with hidden `board=skill` and the selected year.
- Selected types remain visible as individually removable chips after the panel is closed.
- A removal preserves every other selection and the year.
- Clear all removes every `hand` parameter.
- The explanatory copy says any selected type qualifies and more matches rank first.

`NotableWinRow` tests must prove one item shows rank, winner, Singapore date, every label, and `1 label`/`n labels`.

- [ ] **Step 2: Run focused RED**

```bash
npx vitest run tests/components/HandTypeFilter.test.tsx tests/components/NotableWinRow.test.tsx
```

Expected: FAIL because both components are absent.

- [ ] **Step 3: Build the server-rendered GET filter panel**

Keep `HandTypeFilter.tsx` a Server Component: use `<details>`/`<summary>`, a normal GET `<form action="/">`, real checkbox inputs named `hand`, and `Link` chips generated by `standingsHref`. No browser state or new client bundle is needed because the address is the recoverable state.

Use these props:

```ts
type HandType = {
  id: string;
  name: string;
  local_name: string | null;
  rarity: 'uncommon' | 'rare' | 'legendary';
};

export function HandTypeFilter({
  handTypes,
  selectedIds,
  year,
}: {
  handTypes: HandType[];
  selectedIds: string[];
  year: YearSelection;
})
```

- [ ] **Step 4: Build one individual-win row**

Use a semantic `<li>` with a visible rank, winner, `formatSingaporeWinDate(createdAt)`, all label chips, and total count. Do not render the photo here; the gallery remains the photo archive.

- [ ] **Step 5: Add failing homepage integration tests**

Cover:

- `skill` reads the 12-type catalogue, ignores malformed/unknown/repeated `hand` values, and sends only valid unique IDs to `notable_wins_board`.
- No filters send an empty array.
- Several filters are sent together; the page trusts the RPC's returned order.
- One multi-label result produces one row with every label.
- An empty filtered result says `No notable wins match these hand types.`
- An empty unfiltered result says `No notable wins yet.`
- An RPC failure says `Couldn’t load this board`.
- `View hand gallery` remains present and does not carry temporary hand filters.

- [ ] **Step 6: Query and render the ranking**

Use the shared catalogue and already-normalized URL filters from Task 8, then call on `skill`:

```ts
createAdminClient().rpc('notable_wins_board', {
  p_academic_year: selectedYear === 'all' ? null : selectedYear,
  p_hand_ids: selectedHandIds,
});
```

Parse each `hand_types` JSON value defensively into the same `HandType[]` shape. A malformed row is a board error, not an excuse to render a partial win. Render `HandTypeFilter`, then the ranked ordered list exactly as returned.

- [ ] **Step 7: Run the homepage/component slice GREEN**

```bash
npx vitest run tests/components/HandTypeFilter.test.tsx tests/components/NotableWinRow.test.tsx tests/components/HomeBoards.test.tsx tests/standings.test.ts
```

Expected: PASS with exact labels, shared period, valid URL recovery, match-any eligibility, and match-count-first results.

- [ ] **Step 8: Commit**

```bash
git add src/components/HandTypeFilter.tsx src/components/NotableWinRow.tsx src/app/page.tsx tests/components/HandTypeFilter.test.tsx tests/components/NotableWinRow.test.tsx tests/components/HomeBoards.test.tsx
git commit -m "feat: rank and filter individual notable wins"
```

---

### Task 10: Cross-Layer Regression and Local Acceptance

**Files:**
- Modify only if a failing test exposes a defect; return to a focused RED test before each production-code change.

- [ ] **Step 1: Run every focused feature slice**

```bash
npx vitest run tests/actions/game.test.ts tests/components/NotableLogger.test.tsx tests/components/ChipLive.test.tsx tests/components/HandsGallery.test.tsx tests/pages/hands-page.test.ts tests/standings.test.ts tests/components/YearPills.test.tsx tests/components/HandTypeFilter.test.tsx tests/components/NotableWinRow.test.tsx tests/components/HomeBoards.test.tsx
bash tests/database/run-migrations.sh
```

Expected: all focused application tests and the full migration replay pass.

- [ ] **Step 2: Run the full local release gates**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: the complete Vitest suite passes, type generation/typecheck passes, lint has no new errors, and the production build compiles.

- [ ] **Step 3: Inspect the complete feature diff**

Read the full design-commit-to-HEAD diff with fresh context. Check:

- No historical migration was edited.
- 0011/0012 appear in every full-stack replay block and the coverage guard agrees.
- Existing claim count/identity/photo paths survive backfill.
- Old app writes populate the join table and `skill_board` remains claim-counted.
- New app writes exactly one parent with all labels and cleans failed uploads.
- Browser roles have no new writes or RPC execution.
- Every tab/year/filter link preserves the approved state and ignores invalid values.
- PPG and notable order exist only in SQL, not duplicated in TypeScript.
- Live and gallery render one item per parent claim.
- No app-mode scoring copy remains on the homepage.

- [ ] **Step 4: Run local browser acceptance**

Start a production build locally and verify at mobile width and desktop width:

1. Bare `/` defaults to the current academic year when populated, otherwise All time.
2. The three exact tab labels render and share the selected year.
3. Pts per game shows signed one-decimal values and counted-game context.
4. Notable wins with no filters ranks all hands by label count.
5. Selecting several types leaves visible chips; a three-match hand outranks a two-match hand, which outranks a one-match hand.
6. Browser Back restores the previous filters.
7. In an active chip game, one winner plus several grouped labels saves one live entry.
8. Photo capture/library, preview replacement/removal, failure escape, and post-save removal behave unchanged.
9. The gallery shows one card with all labels and remains unfiltered.
10. No page scrolls horizontally and every checkbox/button target is usable by touch and keyboard.

- [ ] **Step 5: Request code review, if Bryan explicitly permits delegation**

This session must not dispatch a review subagent unless Bryan explicitly asks. Otherwise perform the fresh-context review in Step 3 directly.

- [ ] **Step 6: Commit any test-driven corrections and re-run all gates**

Stage only exact changed paths. Do not use `git add .`. End with a clean worktree and report the final local commit SHA.

---

### Task 11: STOP at the Two Production Gates

- [ ] **Gate A — Bryan approves database application**

Only after explicit approval, apply additive migrations 0011 and 0012 to hosted Supabase. Before applying, record the hosted migration list and verify no unexpected pending migration exists. After applying, verify against hosted data:

- Existing claim count equals distinct parent claims represented in `notable_claim_types`.
- Every pre-release claim has exactly one joined label.
- Existing IDs, photo paths, and timestamps are unchanged.
- The old `log_notable_claim` creates one joined label.
- `skill_board`, `lifetime_board`, and the currently deployed app remain readable.
- Browser roles cannot write the new table or execute any of the three new functions.
- Service role can execute/read the new contracts.

Do not push application code as part of Gate A. If any check fails, stop; do not deploy the app and do not delete or rewrite existing claims.

- [ ] **Gate B — Bryan separately approves application push/deploy**

Only after Gate A passes and Bryan explicitly approves the target branch, push the application commits. Verify Vercel reached Ready for the exact commit SHA, not merely a recent deployment. Run the production browser acceptance list from Task 10, including a controlled multi-label win with approved test data. Inspect runtime logs for query, RLS, Realtime, and photo errors.

If application rollback is needed, roll back code only. Leave the additive schema, backfill, and compatibility functions in place; the old deployed app remains valid against them.

---

## Self-Review

**Spec coverage.** Shared shell and period are Tasks 7–9. Total score remains on the existing views in Task 8. Latest-20 PPG is Task 2 + Task 8. One-parent/many-label identity, compatible old write, and atomic new write are Tasks 1, 3, and 4. Live one-entry rendering is Task 5. Individual-win ranking and exact filter precedence are Tasks 2 and 9. Complete unfiltered gallery behavior is Task 6. Photo behavior is retained and regression-tested in Tasks 3, 4, 6, and 10. Separate database/application gates are Task 11. Contract cleanup is intentionally absent.

**Placeholder scan.** Production interfaces, SQL query bodies, URL keys, TS signatures, exact labels, exact contexts, test commands, commit paths, and release stops are named. Fixture bulk data is specified as deterministic cases rather than repeated 21-row boilerplate; no implementation decision is left unresolved.

**Type consistency.** `BoardKey` keeps `lifetime | form | skill` in URL helpers and page routing. `YearSelection` is `number | 'all'` everywhere; SQL receives `null | number`. `hand` is `string | string[] | undefined` at the request boundary and a sorted unique `string[]` after validation. Catalogue rarity is the same three-value union in page, logger, filters, query JSON, live, and tests. `logNotable` and `log_notable_win` both carry arrays. PPG remains exact numeric in SQL and becomes one-decimal text only at rendering. Gallery and live DTOs carry arrays of labels while retaining the parent claim ID as identity.

**Release safety.** Both migrations are additive. The existing non-null legacy column is populated on every new multi-label claim. The old RPC delegates to the new atomic RPC. The old aggregate board still counts claims rather than joined labels. Database expansion precedes application deployment, and each production mutation stops for Bryan's explicit approval.
