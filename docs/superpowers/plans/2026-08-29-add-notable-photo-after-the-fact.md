# Add a Notable Photo After the Fact — Release 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone who played a game attach a photo to a notable win from that game after the fact, widen removal to match, and collapse the two ways of viewing a photo into one.

**Architecture:** A new database function writes the photo path under a participant check, in the same transaction, with no assumption about whether the game is still running — that last part is the whole point, because the existing save function refuses a finished game. The win page gains a small client island reusing the logger's existing photo preparation unchanged. The gallery's photo panel is deleted and its tiles become links to the win page, which removes the gallery's client bundle entirely.

**Tech Stack:** Next.js 16.3 App Router, React 19.2, TypeScript, Tailwind, Supabase JS 2.112 (service-role, server-only), PostgreSQL functions (`security definer`, pinned `search_path`), Vitest 4 + Testing Library, `tests/database/run-migrations.sh` against real PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-08-29-notable-win-page-and-filtered-gallery-design.md` (§6, §9, decisions D2, D5, D9, D10)

## A note on this plan's grain

Task 1 carries its migration verbatim, because that is the artifact that gets applied to a live
database and it must be reviewable as written. Tasks 2 to 5 specify their tests as behaviour lists
rather than as full bodies: this plan is being executed in the same session that wrote it, not
handed to someone without context, so transcribing every assertion twice would add length without
adding fidelity. The tests themselves are written first, in the repository, before the code they
cover.

## Global Constraints

- **Database-first.** Migration `0014` is applied to hosted and verified BEFORE any application code is pushed or deployed. Two separate gates: **Gate A** applies and verifies the migration; **Gate B** pushes and deploys the app. Neither is Alfred's to give.
- **Never edit an applied migration.** `0005` and `0011` have run on hosted. Their functions are changed only by `create or replace` inside `0014`, never by editing those files.
- A `create or replace` must restate `language`, `security definer`, and `set search_path = public` in full — omitting one silently changes the function's security properties.
- Every new or replaced function: `revoke all` from `public, anon, authenticated`, `grant execute` to `service_role, postgres`. The migration asserts this itself.
- **Permission is enforced in the database**, inside the transaction that writes. The screen only decides which buttons to draw; a forged flag must buy nothing.
- **A photo is never overwritten.** Adding to a claim that already has one is refused by the function.
- No orphaned objects: everything that can reject does so before the first storage write, and a failed RPC deletes the object it just uploaded.
- Deletion is permanent (the object leaves storage), so removing a photo you did not attach asks first.
- Worktree `/Users/bryan/Desktop/claude code/RVMJ/.worktrees/notable-photo-add`, branch `feat/notable-photo-after-the-fact`, based on `33649da`.
- Checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `bash tests/database/run-migrations.sh`.

---

## Why this needs a migration at all

`log_notable_win` (0011) opens with:

```sql
perform 1 from games where id = p_game_id and status = 'active' and mode = 'chips' for update;
if not found then raise exception 'game is not an active chip game'; end if;
```

That guard is correct for its job — logging a hand at a live table — and it is exactly why attaching a photo to a finished game's win had to be done by hand in the database on 2026-08-29. The new function keeps the same *permission* rule and drops the assumption about *when*.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0014_photo_after_the_fact.sql` (create) | `photo_added_by` column + backfill, `add_notable_photo`, replaced `clear_notable_photo` and `log_notable_win`, grants, assertions |
| `tests/database/photo_after_cases.sql` (create) | Permission and refusal cases run by the harness against real PostgreSQL |
| `src/lib/actions/game.ts` (modify) | `addNotablePhoto`; correct `removeNotablePhoto`'s now-false comment |
| `src/components/NotablePhotoControls.tsx` (create) | The client island: pick, prepare, save, remove, confirm |
| `src/app/hands/[claimId]/page.tsx` (modify) | Read `game_id` + viewer participation + `photo_added_by`; back link honours arrival from the gallery |
| `src/app/hands/HandsGallery.tsx` (modify) | Panel deleted; tiles become links; becomes a Server Component |
| `src/app/hands/page.tsx` (modify) | Pass the return marker to the gallery |

---

### Task 1: Migration 0014 — the database rules

**Files:**
- Create: `supabase/migrations/0014_photo_after_the_fact.sql`
- Create: `tests/database/photo_after_cases.sql`
- Modify: `tests/database/run-migrations.sh` (register the new case file)

**Interfaces:**
- Produces: `add_notable_photo(p_claim_id uuid, p_actor uuid, p_photo_path text) returns void`; `clear_notable_photo(p_claim_id uuid, p_actor uuid) returns text` (replaced, widened); `notable_claims.photo_added_by uuid`.

- [ ] **Step 1: Write the migration**

```sql
begin;

-- ---------------------------------------------------------------------------
-- 0014 — attaching a photo to a notable win AFTER the game has finished.
--
-- log_notable_win (0011) refuses a game that is not active, which is correct for logging a hand
-- at a live table and is precisely why a photo could not be attached to a finished game without
-- editing this database by hand. This migration keeps that function's PERMISSION rule -- you must
-- have played in the game -- and drops its assumption about WHEN.
-- ---------------------------------------------------------------------------

-- Who put the photo there, which is not the same person as who logged the win once a photo can be
-- added later. Nullable because most claims have no photo at all.
alter table notable_claims add column photo_added_by uuid references players(id);

-- Every photo that exists today was attached at log time by the logger, so the column is true for
-- history rather than empty for it. Without this the confirmation below could not tell an old
-- photo of your own from somebody else's.
update notable_claims set photo_added_by = logged_by where photo_path is not null;

-- ---------------------------------------------------------------------------
-- Attach a photo to an existing claim.
--
-- No games.status check ON PURPOSE -- see the header. The participant check is the same one
-- log_notable_win applies, read through the claim's own game.
--
-- Refuses a claim that already has a photo: this feature fills a gap, it does not overwrite. The
-- caller has already uploaded an object by the time this runs, so a refusal here is what tells it
-- to delete those bytes again.
-- ---------------------------------------------------------------------------
create function public.add_notable_photo(
  p_claim_id uuid,
  p_actor uuid,
  p_photo_path text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_game_id uuid;
  v_existing text;
begin
  if p_photo_path is null or length(trim(p_photo_path)) = 0 then
    raise exception 'a photo path is required';
  end if;

  select game_id, photo_path into v_game_id, v_existing
  from notable_claims where id = p_claim_id
  for update;
  if not found then raise exception 'no such win'; end if;

  perform 1 from game_players where game_id = v_game_id and player_id = p_actor;
  if not found then raise exception 'you did not play in this game'; end if;

  if v_existing is not null then raise exception 'this win already has a photo'; end if;

  update notable_claims
  set photo_path = p_photo_path, photo_added_by = p_actor
  where id = p_claim_id;
end $$;

-- ---------------------------------------------------------------------------
-- Removal widens to match. 0005 restricted this to whoever LOGGED the claim; once anyone at the
-- table can attach a photo, that rule would let a player attach one they could not take down.
--
-- Replaced rather than edited: 0005 has run on hosted, and an applied migration is never changed.
-- The signature is unchanged, so 0005's own function-count assertions still hold.
-- ---------------------------------------------------------------------------
create or replace function public.clear_notable_photo(p_claim_id uuid, p_actor uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_path text;
  v_game_id uuid;
begin
  select photo_path, game_id into v_path, v_game_id
  from notable_claims where id = p_claim_id
  for update;
  if not found then raise exception 'no such win'; end if;

  perform 1 from game_players where game_id = v_game_id and player_id = p_actor;
  if not found then raise exception 'you did not play in this game'; end if;

  update notable_claims set photo_path = null, photo_added_by = null where id = p_claim_id;
  return v_path;
end $$;

-- ---------------------------------------------------------------------------
-- The logger records the new column too, so a photo attached at log time and one attached later
-- are described the same way. Everything else about this function is 0011's text verbatim; only
-- the insert's column list and values change.
-- ---------------------------------------------------------------------------
create or replace function public.log_notable_win(
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
    game_id, player_id, notable_hand_id, logged_by, photo_path, photo_added_by
  ) values (
    p_game_id, p_player_id, v_hand_ids[1], p_logged_by, p_photo_path,
    case when p_photo_path is null then null else p_logged_by end
  ) returning id into v_id;

  insert into notable_claim_types (claim_id, notable_hand_id)
  select v_id, unnest(v_hand_ids)
  on conflict (claim_id, notable_hand_id) do nothing;

  update games set last_activity_at = now() where id = p_game_id;
  return v_id;
end $$;

revoke all privileges on function public.add_notable_photo(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.add_notable_photo(uuid, uuid, text)
  to service_role, postgres;
revoke all privileges on function public.clear_notable_photo(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.clear_notable_photo(uuid, uuid)
  to service_role, postgres;

-- ---------------------------------------------------------------------------
-- This migration asserts its own outcome, so a later edit that loosens it fails here rather than
-- in production. A create or replace that dropped `security definer` or the pinned search_path
-- would otherwise be invisible.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.add_notable_photo(uuid,uuid,text)'::regprocedure,
      'public.clear_notable_photo(uuid,uuid)'::regprocedure,
      'public.log_notable_win(uuid,uuid,uuid[],uuid,text)'::regprocedure
    )
    and (not p.prosecdef or not (p.proconfig @> array['search_path=public']))
  ) then
    raise exception 'photo functions must be security definer with search_path=public';
  end if;

  if has_function_privilege('anon', 'public.add_notable_photo(uuid,uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.add_notable_photo(uuid,uuid,text)', 'execute')
     or not has_function_privilege('service_role', 'public.add_notable_photo(uuid,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.clear_notable_photo(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.clear_notable_photo(uuid,uuid)', 'execute')
  then
    raise exception 'photo function access is wrong';
  end if;

  -- The backfill is part of the contract, not a convenience: a photographed claim with no
  -- attributed adder would make the confirmation lie about whose photo it is.
  if exists (select 1 from notable_claims where photo_path is not null and photo_added_by is null) then
    raise exception 'every photographed claim must record who attached it';
  end if;
end $$;

commit;
```

- [ ] **Step 2: Write the behavioural cases**

Create `tests/database/photo_after_cases.sql` following the style of `tests/database/house_cases.sql`. It must assert, against real PostgreSQL, all of:

1. A participant attaches a photo to a win in an **ended** game — succeeds, and `photo_added_by` is that participant.
2. A non-participant is refused with `you did not play in this game`, and the row is unchanged.
3. A claim that already has a photo is refused with `this win already has a photo`, and the existing path is unchanged.
4. An unknown claim id is refused with `no such win`.
5. A null or blank path is refused with `a photo path is required`.
6. A participant who did **not** attach the photo can still clear it (the widening), and clearing nulls both `photo_path` and `photo_added_by`.
7. A non-participant cannot clear it.
8. `log_notable_win` with a photo sets `photo_added_by` to the logger; without a photo leaves it null.
9. Every pre-existing photographed claim has a non-null `photo_added_by` after the backfill.

- [ ] **Step 3: Register the cases and run the harness**

Add `photo_after_cases.sql` to `tests/database/run-migrations.sh` where the other case files are invoked.

Run: `bash tests/database/run-migrations.sh`
Expected: every migration replays across all database shapes and every case above passes.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0014_photo_after_the_fact.sql tests/database/photo_after_cases.sql tests/database/run-migrations.sh
git commit -m "feat(db): let a player attach a photo to a finished game's win"
```

---

### Task 2: The server action

**Files:**
- Modify: `src/lib/actions/game.ts`
- Test: `tests/actions/` (match the existing action test style)

**Interfaces:**
- Produces: `addNotablePhoto(claimId: string, photo: Blob): Promise<{ error?: string }>`
- Consumes: `MAX_UPLOAD_BYTES`, `detectStoredPhotoFormat`, `PHOTO_BUCKET` from `src/lib/image`; `requireUser` from this file.

- [ ] **Step 1: Write the failing tests**

Cover: rejects an oversized blob before any upload; rejects an unsupported format before any upload; uploads under `<gameId>/<uuid>.<ext>`; calls `add_notable_photo` with the claim, the caller, and that path; **deletes the uploaded object when the RPC refuses**; returns the RPC's message on refusal; needs no participant check in TypeScript because the function enforces it.

- [ ] **Step 2: Run the tests and confirm they fail**

- [ ] **Step 3: Implement**

```ts
/**
 * Attach a photo to a win that has none.
 *
 * No requireParticipant here, and that is deliberate rather than an omission: the question is
 * "did you play in the game this CLAIM belongs to", which needs the claim read first, and
 * `add_notable_photo` answers it inside the transaction that writes the path. A check here as
 * well would be a second copy of the rule, free to drift from the one that actually decides.
 *
 * The game id is read only to build the storage path, which is the same `<gameId>/<uuid>.<ext>`
 * convention the logger uses so every object in the bucket sorts by game.
 */
export async function addNotablePhoto(claimId: string, photo: Blob): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const admin = createAdminClient();

    const { data: claim, error: readError } = await admin
      .from('notable_claims').select('game_id').eq('id', claimId).maybeSingle();
    if (readError) return { error: readError.message };
    if (!claim) return { error: 'no such win' };

    // Everything that can reject does so before the first storage write, so a caller who fails
    // validation can never leave bytes behind.
    if (photo.size > MAX_UPLOAD_BYTES) return { error: 'That photo is too large.' };
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const format = detectStoredPhotoFormat(bytes);
    if (!format) return { error: 'That file is not a supported image.' };

    const path = `${claim.game_id as string}/${crypto.randomUUID()}.${format.extension}`;
    const { error: uploadError } = await admin.storage.from(PHOTO_BUCKET)
      .upload(path, bytes, { contentType: format.contentType });
    if (uploadError) return { error: 'Could not upload the photo.' };

    const { error } = await admin.rpc('add_notable_photo', {
      p_claim_id: claimId,
      p_actor: user.id,
      p_photo_path: path,
    });
    if (error) {
      // No orphans. The refusal may be "already has a photo", in which case these bytes are a
      // duplicate of something already on screen.
      await admin.storage.from(PHOTO_BUCKET).remove([path]);
      return { error: error.message };
    }
    return {};
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'failed to add the photo' };
  }
}
```

Also correct `removeNotablePhoto`'s comment, which 0014 makes false:

```ts
    // No requireParticipant here on purpose: the question is not "are you at this table" but
    // "did you play in the game this claim belongs to", and the RPC answers it inside the
    // transaction that clears it. Widened from "did you log this claim" by migration 0014, so
    // that whoever may attach a photo may also take it down.
```

- [ ] **Step 4: Run the tests and confirm they pass**

- [ ] **Step 5: Commit**

---

### Task 3: The win page learns who is looking

**Files:**
- Modify: `src/app/hands/[claimId]/page.tsx`
- Test: `tests/pages/notable-win-page.test.ts`

- [ ] **Step 1: Write the failing tests**

Cover: the claim read now selects `game_id` and `photo_added_by`; a viewer in `game_players` for that game gets `canEdit`; a viewer who is not gets `canEdit` false and **no controls rendered at all**; `photoAddedByMe` is true only when the viewer attached it; arriving with `from=hands` produces a back link to `/hands?…` carrying year, hand and `all`; without it the back link still points at the board.

- [ ] **Step 2: Run the tests and confirm they fail**

- [ ] **Step 3: Implement**

Add `game_id, photo_added_by` to the select. After the claim read, one small query:

```ts
  // Whether to DRAW the controls. It decides nothing: `add_notable_photo` and
  // `clear_notable_photo` both re-check participation inside the transaction that writes, so a
  // forged flag here buys a button that the database refuses.
  const { data: seat } = await admin.from('game_players')
    .select('seat').eq('game_id', row.game_id).eq('player_id', user.id).maybeSingle();
  const canEdit = Boolean(seat);
```

Back link: read `from` from `searchParams`; when it is `hands`, rebuild `/hands?<year/hand/all>` instead of the board address, using the same parts-not-whole discipline.

- [ ] **Step 4: Run the tests and confirm they pass**

- [ ] **Step 5: Commit**

---

### Task 4: The photo controls

**Files:**
- Create: `src/components/NotablePhotoControls.tsx`
- Modify: `src/components/NotableWinDetail.tsx` (accept the controls as a slot)
- Test: `tests/components/NotablePhotoControls.test.tsx`

**Interfaces:**
- Produces: `NotablePhotoControls({ claimId, hasPhoto, addedByMe }: { claimId: string; hasPhoto: boolean; addedByMe: boolean })`
- Consumes: `preparePhoto` from `src/lib/image`; `addNotablePhoto`, `removeNotablePhoto` from `src/lib/actions/game`.

- [ ] **Step 1: Write the failing tests**

Cover: with no photo it offers **Take photo** and **Choose from library** (the two-input pattern the logger already uses, so the camera and the library are separate controls on iOS); a chosen file is prepared before upload and its preview is shown with a way to discard it; **Save photo** calls the action with the prepared blob; a failure keeps the chosen photo so the player can retry rather than re-picking; with a photo it offers **Remove photo**; removing a photo you attached is one tap; removing one you did not attach asks first and does nothing until confirmed; after either success the page refreshes.

- [ ] **Step 2: Run the tests and confirm they fail**

- [ ] **Step 3: Implement**

A `'use client'` component. Reuse the logger's structure: two `sr-only` file inputs (`capture="environment"` for the camera, plain for the library) driven by two visible `Button`s, a `preparingPhoto` flag that disables both while `preparePhoto` runs, an error `LiveRegion`, and `router.refresh()` on success. The confirmation for someone else's photo is a two-state button, not a browser `confirm()` — the rest of this app never uses one.

- [ ] **Step 4: Wire it into the detail component**

`NotableWinDetail` takes an optional `controls?: ReactNode` and renders it under the photo area. The detail component stays presentational and stays a Server Component; only the island inside it is client-side.

- [ ] **Step 5: Run the tests and confirm they pass**

- [ ] **Step 6: Commit**

---

### Task 5: The gallery tile becomes a link (D9, Option A)

**Files:**
- Modify: `src/app/hands/HandsGallery.tsx`
- Modify: `src/app/hands/page.tsx`
- Test: `tests/components/HandsGallery.test.tsx`, `tests/pages/hands-page.test.ts`

- [ ] **Step 1: Write the failing tests**

Cover: a tile is a link to `/hands/<claimId>?…&from=hands`, carrying the gallery's own year, hand and `all` so the win page can return the player to the archive they left; the tile still names the winner and the hands for a screen reader; **no photo panel is rendered and no remove control exists in the gallery**; the empty states are unchanged; the component renders with no client-side hooks.

- [ ] **Step 2: Run the tests and confirm they fail**

- [ ] **Step 3: Implement**

Delete `'use client'`, the `useState`/`useRouter` imports, the `FullScreenPanel` block, the remove handler and the `mine` field from `HandPhoto`. The tile's `<button>` becomes a `<Link>`. `HandsGallery` gains a `returnQuery: string` prop from the page so it can build each tile's address.

`FullScreenPanel` itself stays — eight other screens use it.

Drop the now-unused `logged_by` from the archive select and the `mine` computation in `src/app/hands/page.tsx`.

- [ ] **Step 4: Run the tests and confirm they pass**

- [ ] **Step 5: Commit**

---

### Task 6: Whole-branch verification

- [ ] **Step 1:** `npm test` — every test passes, count above 637.
- [ ] **Step 2:** `npm run typecheck` — clean.
- [ ] **Step 3:** `npm run lint` — 0 errors; only the known `GameLive` `_props` warning.
- [ ] **Step 4:** `npm run build` — compiles. Confirm `/hands` no longer ships a client bundle for the panel.
- [ ] **Step 5:** `bash tests/database/run-migrations.sh` — passes against real PostgreSQL.
- [ ] **Step 6:** `git diff --check` — clean.
- [ ] **Step 7: Report and STOP at Gate A.** Do not apply `0014` to hosted, do not push, do not deploy.

---

## Release gates

**Gate A — the database.** Bryan's to give. Apply `0014` to hosted, then verify on hosted, not locally: the ledger row exists exactly once; `photo_added_by` exists; no photographed claim has a null adder; the three functions exist with the right signatures, are `security definer` with a pinned search path, and are callable by `service_role` but not by `anon` or `authenticated`.

The old application keeps working across this migration: it adds a nullable column and replaces functions whose signatures are unchanged, so the currently deployed code is unaffected.

**Gate B — the release.** Separate, and only after Gate A is verified. Push and deploy, then check the live surface.

## Verification the tests cannot do

Owed to Bryan on a real phone after Gate B: taking a photo of a finished hand and attaching it, choosing one from the library instead, seeing another player's photo and being asked before removing it, and confirming a gallery tile now opens the win page and Back returns to the gallery rather than the board.
