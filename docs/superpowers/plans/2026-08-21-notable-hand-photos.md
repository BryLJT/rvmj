# Notable-Hand Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player photograph the tiles while logging a chip-mode notable hand, and browse every photographed hand afterwards.

**Architecture:** The photo is shrunk and re-encoded to WebP on the phone before upload. A server action verifies the caller is a participant, sniffs the bytes, writes to a private Supabase Storage bucket, then records the claim pointing at it; a failed claim deletes the object it just uploaded. Nothing but the service-role key ever touches the bucket, so it carries no RLS policies at all. Display uses one-hour signed URLs minted server-side.

**Tech Stack:** Next.js 16.3 (App Router, Server Actions), React 19.2, TypeScript, Supabase (Postgres + Storage), Vitest 4 with two projects (`node` and `components`/jsdom), Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-21-notable-hand-photos-design.md`

## Global Constraints

- **Chip mode only.** App-mode notables live in `scoring_events` and have no claim row. Do not touch `GameLive.tsx`.
- **One photo per claim**, enforced structurally by a single nullable column. Never add a second column or a join table.
- **The bucket gets no RLS policies.** Only `service_role` reads or writes it. Say so in a comment so a later reader does not "fix" the absence.
- **Bucket:** `notable-photos`, private, `file_size_limit` 2097152 bytes, `allowed_mime_types` `{image/webp}`.
- **Object path:** `{game_id}/{uuid}.webp`. A fresh UUID, never the claim id, because the object is uploaded before the claim row exists.
- **Signed URL TTL:** 3600 seconds.
- **Downscale:** longest edge 1600px, WebP quality 0.82. This is not an optimisation, it is required: it strips EXIF GPS and converts iPhone HEIC.
- **Never trust a declared MIME type.** Sniff magic bytes server-side.
- **Do NOT edit the literal `15`** in `supabase/migrations/0004_explicit_access_grants.sql`. See Task 2.
- **Photos are decoration.** A photo or signing failure must never change `syncState` or block a chip action.
- **No em dashes in user-facing copy.**
- Tests requiring a DOM must live under `tests/components/`; the Vitest config gives jsdom to that directory only.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/image.ts` (create) | Pure fit math + thin canvas glue for downscale/re-encode. No React, no network. |
| `supabase/migrations/0005_notable_photos.sql` (create) | Column, bucket, replaced RPC, delete RPC, and its own hardening block. |
| `src/lib/actions/game.ts` (modify) | `logNotable` gains a photo leg; adds `removeNotablePhoto` and `signNotablePhotos`. |
| `src/app/game/[id]/NotableLogger.tsx` (modify) | Capture control, preview, and the "log it without the photo" escape. |
| `src/app/game/[id]/ChipLive.tsx` (modify) | Reads `photo_path`, fetches signed URLs in a separate effect, renders thumbnails. |
| `src/app/hands/page.tsx` (create) | Signed-in archive, newest first, grouped by night. |
| `src/app/hands/HandsGallery.tsx` (create) | Client: grouping, full-screen view, and the logger's own delete. |
| `src/app/page.tsx` (modify) | One link to the archive. |

---

### Task 1: Image downscale helper

Pure fit math is separated from canvas work so the arithmetic is fully tested and the untestable glue stays thin.

**Files:**
- Create: `src/lib/image.ts`
- Test: `tests/components/image.test.ts`

> The test lives under `tests/components/` because that is the only Vitest project given a jsdom environment. It is not a React component.

**Interfaces:**
- Consumes: nothing
- Produces:
  - `MAX_EDGE: 1600`, `WEBP_QUALITY: 0.82`, `MAX_UPLOAD_BYTES: 2097152`
  - `fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number }`
  - `downscaleToWebp(file: File): Promise<Blob>`

- [ ] **Step 1: Write the failing test for the fit math**

Create `tests/components/image.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fitWithin, MAX_EDGE } from '../../src/lib/image';

describe('fitWithin', () => {
  it('shrinks a landscape phone photo to the max edge, preserving aspect', () => {
    expect(fitWithin(4032, 3024, MAX_EDGE)).toEqual({ width: 1600, height: 1200 });
  });

  it('shrinks a portrait phone photo by its longest edge', () => {
    expect(fitWithin(3024, 4032, MAX_EDGE)).toEqual({ width: 1200, height: 1600 });
  });

  it('never upscales an image already smaller than the max edge', () => {
    expect(fitWithin(800, 600, MAX_EDGE)).toEqual({ width: 800, height: 600 });
  });

  it('handles a square image', () => {
    expect(fitWithin(2000, 2000, MAX_EDGE)).toEqual({ width: 1600, height: 1600 });
  });

  it('never returns a zero dimension for an extreme aspect ratio', () => {
    const { width, height } = fitWithin(8000, 3, MAX_EDGE);
    expect(width).toBe(1600);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/image.test.ts`
Expected: FAIL, cannot resolve `../../src/lib/image`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/image.ts`:

```ts
export const MAX_EDGE = 1600;
export const WEBP_QUALITY = 0.82;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Fit a photo inside a square of `maxEdge`, preserving aspect ratio and never upscaling.
 * Pure arithmetic, kept separate from canvas work so it can be tested exhaustively.
 */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  // A very wide panorama would otherwise round its short edge to 0 and produce an empty canvas.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/image.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing test for the canvas glue**

Append to `tests/components/image.test.ts`:

```ts
import { afterEach, beforeEach, vi } from 'vitest';
import { downscaleToWebp, MAX_UPLOAD_BYTES } from '../../src/lib/image';

const drawImage = vi.fn();
let toBlobResult: Blob | null;

beforeEach(() => {
  toBlobResult = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4032, height: 3024, close: vi.fn() })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
    cb(toBlobResult);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  drawImage.mockReset();
});

describe('downscaleToWebp', () => {
  it('draws the image at the fitted size and returns a WebP blob', async () => {
    const blob = await downscaleToWebp(new File([new Uint8Array([9])], 'hand.heic', { type: 'image/heic' }));

    expect(blob.type).toBe('image/webp');
    const [, , , , drawnWidth, drawnHeight] = drawImage.mock.calls[0];
    expect(drawnWidth).toBe(1600);
    expect(drawnHeight).toBe(1200);
  });

  it('rejects when the browser cannot encode the image', async () => {
    toBlobResult = null;
    await expect(downscaleToWebp(new File([new Uint8Array([9])], 'x.jpg', { type: 'image/jpeg' })))
      .rejects.toThrow('Could not read that photo');
  });

  it('rejects a re-encoded photo that is still over the upload limit', async () => {
    toBlobResult = new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: 'image/webp' });
    await expect(downscaleToWebp(new File([new Uint8Array([9])], 'x.jpg', { type: 'image/jpeg' })))
      .rejects.toThrow('still too large');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/components/image.test.ts`
Expected: FAIL, `downscaleToWebp is not a function`.

- [ ] **Step 7: Implement the canvas glue**

Append to `src/lib/image.ts`:

```ts
/**
 * Re-encode a captured photo to a bounded WebP.
 *
 * Three things fall out of this one step, and all three are load-bearing:
 *   1. a ~4MB phone photo becomes ~300KB, which is the difference between a moment and a stall
 *      on table wifi;
 *   2. iPhone HEIC becomes a format browsers can actually display;
 *   3. all EXIF is discarded, so an uploaded photo cannot disclose where the group plays.
 * Because of (3) this is a privacy control, not an optimisation. Do not make it optional.
 */
export async function downscaleToWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not read that photo. Try again.');
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY);
    });
    if (!blob) throw new Error('Could not read that photo. Try again.');
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That photo is still too large after shrinking.');
    return blob;
  } finally {
    bitmap.close?.();
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/components/image.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
git add src/lib/image.ts tests/components/image.test.ts
git commit -m "feat: add bounded WebP downscale helper"
```

---

### Task 2: Migration 0005

**Files:**
- Create: `supabase/migrations/0005_notable_photos.sql`
- Verify against: `supabase/migrations/0004_explicit_access_grants.sql` (read only, never edit)

**Interfaces:**
- Consumes: nothing
- Produces:
  - column `notable_claims.photo_path text` (nullable)
  - `log_notable_claim(uuid, uuid, uuid, uuid, text)` returns uuid
  - `clear_notable_photo(uuid, uuid)` returns text (the freed path, or null)
  - storage bucket `notable-photos`

> **Read this before writing the file.** `0004` normalizes protected functions by matching
> `p.proname in (...)` — **name only, not signature** — and then asserts
> `if v_count <> 15 then raise exception`. `log_notable_claim` is on that list. Adding a
> parameter creates a *second overload under the same name*, so a database rebuilt from
> migrations would count 16 and abort the whole chain. The fix is to drop the old signature.
> **Do not "fix" it by changing 15 to 16** — that literal is a correct statement about the
> world at `0004`'s point in the chain, and editing it would make a future rebuild pass while
> silently proving nothing.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0005_notable_photos.sql`:

```sql
-- ============ NOTABLE-HAND PHOTOS ============
-- One photo per claim. "One" is enforced structurally by there being a single column, not by
-- a constraint that a later migration could relax by accident.
alter table notable_claims add column photo_path text;

-- ---------------------------------------------------------------------------
-- The four-parameter function is DROPPED, not replaced.
--
-- 0004's normalize loop matches protected functions BY NAME and asserts it found exactly 15.
-- Leaving the old signature in place would put two `log_notable_claim` rows in pg_proc, so any
-- database rebuilt from these migrations counts 16 and aborts. Do NOT edit the 15 in 0004.
-- ---------------------------------------------------------------------------
drop function if exists log_notable_claim(uuid, uuid, uuid, uuid);

create function log_notable_claim(
  p_game_id uuid,
  p_player_id uuid,
  p_notable_hand_id uuid,
  p_logged_by uuid,
  p_photo_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform 1 from games
  where id = p_game_id and status = 'active' and mode = 'chips'
  for update;
  if not found then raise exception 'game is not an active chip game'; end if;

  perform 1 from game_players where game_id = p_game_id and player_id = p_player_id;
  if not found then raise exception 'claimed player is not in this game'; end if;
  perform 1 from game_players where game_id = p_game_id and player_id = p_logged_by;
  if not found then raise exception 'logger is not in this game'; end if;

  insert into notable_claims (game_id, player_id, notable_hand_id, logged_by, photo_path)
  values (p_game_id, p_player_id, p_notable_hand_id, p_logged_by, p_photo_path)
  returning id into v_id;
  update games set last_activity_at = now() where id = p_game_id;
  return v_id;
end $$;

-- Authorization lives HERE, not only in the server action. A rule enforced solely in
-- application code protects you exactly until someone adds a second caller.
--
-- Returns the freed path so the caller knows which object to delete. A claim that is yours but
-- has no photo is a successful no-op returning null, not an error.
create function clear_notable_photo(p_claim_id uuid, p_actor uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_path text;
begin
  select photo_path into v_path from notable_claims
  where id = p_claim_id and logged_by = p_actor
  for update;
  if not found then raise exception 'not your claim'; end if;

  update notable_claims set photo_path = null where id = p_claim_id;
  return v_path;
end $$;

-- ---------------------------------------------------------------------------
-- 0005 carries its own hardening. An applied migration cannot be extended, so the pattern from
-- 0004 is repeated here for the objects this migration introduces.
--
-- The count of 2 does double duty: if the old four-parameter overload had survived the drop
-- above, this loop would find 3 and fail here rather than in a confusing rebuild months later.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('log_notable_claim', 'clear_notable_photo')
  loop
    execute format('revoke all privileges on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role, postgres', r.signature);
    v_count := v_count + 1;
  end loop;
  if v_count <> 2 then
    raise exception 'expected to normalize 2 photo functions, found % (a stale log_notable_claim overload?)', v_count;
  end if;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('log_notable_claim', 'clear_notable_photo')
  loop
    if has_function_privilege('anon', r.oid, 'execute')
      or has_function_privilege('authenticated', r.oid, 'execute')
      or not has_function_privilege('service_role', r.oid, 'execute')
    then
      raise exception 'photo function access is wrong for %', r.proname;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Private bucket. Limits are set here as well as in the server action: defence in depth, so a
-- bug in application validation cannot fill the bucket with arbitrary files.
--
-- NO storage policies are created, deliberately. Uploads are server-mediated and reads use
-- server-minted signed URLs, so no `anon` or `authenticated` role ever touches this bucket.
-- The absence of policies IS the design. Do not "fix" it by adding one.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notable-photos', 'notable-photos', false, 2097152, array['image/webp'])
on conflict (id) do nothing;
```

- [ ] **Step 2: Verify the whole chain replays from scratch**

This is the step that proves the §6.1 hazard is closed. It rebuilds the local database from
migration `0001` onward.

Run:
```bash
npx supabase start
npx supabase db reset
```

Expected: completes with no error. Specifically **no** `expected to normalize 15 protected functions, found 16`, and **no** `expected to normalize 2 photo functions, found 3`.

If either appears, the `drop function` line is missing or its signature does not match.

- [ ] **Step 3: Verify the new objects exist and are locked down**

Run:
```bash
npx supabase db reset >/dev/null 2>&1 && psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -c "
select proname, pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in ('log_notable_claim','clear_notable_photo') order by proname;
select column_name from information_schema.columns where table_name='notable_claims' and column_name='photo_path';
select id, public from storage.buckets where id='notable-photos';
"
```

Expected: exactly two function rows (`clear_notable_photo` with 2 args, `log_notable_claim` with **5**), one column row, and one bucket row with `public = f`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0005_notable_photos.sql
git commit -m "feat: add notable-hand photo column, bucket and RPCs"
```

---

### Task 3: `logNotable` gains a photo leg

The guards are the deliverable here. Every rejection must happen **before** any storage write, so a hostile or buggy caller cannot fill the bucket.

**Files:**
- Modify: `src/lib/actions/game.ts:39-51` (the existing `logNotable`)
- Test: `tests/actions/game.test.ts`

**Interfaces:**
- Consumes: `MAX_UPLOAD_BYTES` from `src/lib/image.ts` (Task 1)
- Produces:
  - `PHOTO_BUCKET = 'notable-photos'`
  - `logNotable(gameId: string, playerId: string, notableHandId: string, photo?: Blob): Promise<{ error?: string; photoFailed?: boolean }>`
  - `photoFailed: true` is the signal Task 6 uses to reveal the "log it without the photo" escape. It is set **only** when the photo leg failed and the claim was therefore never attempted.

- [ ] **Step 1: Write the failing tests**

Append to `tests/actions/game.test.ts`:

```ts
import { logNotable } from '../../src/lib/actions/game';

const HAND_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_ID = '55555555-5555-5555-5555-555555555555';

/** A minimal valid WebP header: "RIFF" then four size bytes then "WEBP". */
function webpBytes(payload = 32): Uint8Array {
  const bytes = new Uint8Array(12 + payload);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);        // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);        // WEBP
  return bytes;
}

function arrangeNotable({ participant = true, rpcError = null as { message: string } | null } = {}) {
  const upload = vi.fn(async () => ({ data: { path: 'p' }, error: null }));
  const remove = vi.fn(async () => ({ data: null, error: null }));
  const rpc = vi.fn(async () => ({ data: 'claim-id', error: rpcError }));
  const admin = {
    from: vi.fn(() => queryReturning({ data: participant ? { seat: 'E' } : null, error: null })),
    rpc,
    storage: { from: vi.fn(() => ({ upload, remove })) },
  };
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
  });
  mocks.createAdminClient.mockReturnValue(admin);
  return { upload, remove, rpc };
}

describe('logNotable photo leg', () => {
  it('records a claim with a null path when no photo is supplied', async () => {
    const { upload, rpc } = arrangeNotable();

    expect(await logNotable(GAME_ID, OTHER_ID, HAND_ID)).toEqual({});

    expect(upload).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('log_notable_claim', expect.objectContaining({ p_photo_path: null }));
  });

  it('uploads the photo and passes its path to the claim', async () => {
    const { upload, rpc } = arrangeNotable();

    expect(await logNotable(GAME_ID, OTHER_ID, HAND_ID, new Blob([webpBytes()]))).toEqual({});

    expect(upload).toHaveBeenCalledTimes(1);
    const [path, , options] = upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${GAME_ID}/[0-9a-f-]{36}\\.webp$`));
    expect(options).toMatchObject({ contentType: 'image/webp' });
    expect(rpc).toHaveBeenCalledWith('log_notable_claim', expect.objectContaining({ p_photo_path: path }));
  });

  it('rejects a non-participant BEFORE any storage write', async () => {
    const { upload } = arrangeNotable({ participant: false });

    const result = await logNotable(GAME_ID, OTHER_ID, HAND_ID, new Blob([webpBytes()]));

    expect(result.error).toBe('you are not in this game');
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects an oversized photo BEFORE any storage write', async () => {
    const { upload } = arrangeNotable();

    const result = await logNotable(GAME_ID, OTHER_ID, HAND_ID, new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]));

    expect(result.photoFailed).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  // The declared type is what the network SAYS. The bytes are what it IS.
  it('rejects bytes that are not WebP even when the blob claims to be', async () => {
    const { upload } = arrangeNotable();
    const notWebp = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])], { type: 'image/webp' });

    const result = await logNotable(GAME_ID, OTHER_ID, HAND_ID, notWebp);

    expect(result.photoFailed).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it('deletes the uploaded object when recording the claim fails', async () => {
    const { upload, remove } = arrangeNotable({ rpcError: { message: 'game is not an active chip game' } });

    const result = await logNotable(GAME_ID, OTHER_ID, HAND_ID, new Blob([webpBytes()]));

    expect(result.error).toBe('game is not an active chip game');
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });

  // A failed CLAIM is not a failed PHOTO. Offering "log it without the photo" here would just
  // fail again the same way, so the escape must stay hidden.
  it('does not flag photoFailed when the claim itself was rejected', async () => {
    const { remove } = arrangeNotable({ rpcError: { message: 'logger is not in this game' } });

    const result = await logNotable(GAME_ID, OTHER_ID, HAND_ID, new Blob([webpBytes()]));

    expect(result.photoFailed).toBeUndefined();
    expect(remove).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/actions/game.test.ts`
Expected: FAIL. The no-photo case fails on `p_photo_path` missing from the RPC arguments; the rest fail because `logNotable` ignores its fourth argument.

- [ ] **Step 3: Implement the photo leg**

In `src/lib/actions/game.ts`, add near the imports:

```ts
import { MAX_UPLOAD_BYTES } from '../image';

export const PHOTO_BUCKET = 'notable-photos';

/**
 * A server action receives whatever the network sends, so `blob.type` is a claim, not a fact.
 * WebP is a RIFF container: bytes 0-3 are "RIFF" and bytes 8-11 are "WEBP".
 */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
}
```

Replace `logNotable` entirely:

```ts
export async function logNotable(
  gameId: string,
  playerId: string,
  notableHandId: string,
  photo?: Blob,
): Promise<{ error?: string; photoFailed?: boolean }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);

    // Everything that can reject does so before the first storage write, so a caller who fails
    // validation can never leave bytes behind.
    let path: string | null = null;
    if (photo) {
      if (photo.size > MAX_UPLOAD_BYTES) {
        return { error: 'That photo is too large.', photoFailed: true };
      }
      const bytes = new Uint8Array(await photo.arrayBuffer());
      if (!isWebp(bytes)) {
        return { error: 'That file is not a supported image.', photoFailed: true };
      }
      const candidate = `${gameId}/${crypto.randomUUID()}.webp`;
      const { error: uploadError } = await admin.storage.from(PHOTO_BUCKET)
        .upload(candidate, bytes, { contentType: 'image/webp' });
      if (uploadError) {
        return { error: 'Could not upload the photo.', photoFailed: true };
      }
      path = candidate;
    }

    const { error } = await admin.rpc('log_notable_claim', {
      p_game_id: gameId,
      p_player_id: playerId,
      p_notable_hand_id: notableHandId,
      p_logged_by: user.id,
      p_photo_path: path,
    });
    if (error) {
      // No orphans from a failed claim. Note this is NOT photoFailed: the photo was fine, the
      // claim was refused, and retrying without the photo would be refused identically.
      if (path) await admin.storage.from(PHOTO_BUCKET).remove([path]);
      return { error: error.message };
    }
    return {};
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'failed to log' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/actions/game.test.ts`
Expected: PASS, including the pre-existing `endAbandonedGame` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/game.ts tests/actions/game.test.ts
git commit -m "feat: accept a photo when logging a notable hand"
```

---

### Task 4: Deleting a photo

**Files:**
- Modify: `src/lib/actions/game.ts`
- Test: `tests/actions/game.test.ts`

**Interfaces:**
- Consumes: `PHOTO_BUCKET` (Task 3), `clear_notable_photo` RPC (Task 2)
- Produces: `removeNotablePhoto(claimId: string): Promise<{ error?: string }>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/actions/game.test.ts`:

```ts
import { removeNotablePhoto } from '../../src/lib/actions/game';

const CLAIM_ID = '66666666-6666-6666-6666-666666666666';

function arrangeRemove(rpcResult: { data: string | null; error: { message: string } | null }) {
  const remove = vi.fn(async () => ({ data: null, error: null }));
  const rpc = vi.fn(async () => rpcResult);
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
  });
  mocks.createAdminClient.mockReturnValue({ rpc, storage: { from: vi.fn(() => ({ remove })) } });
  return { remove, rpc };
}

describe('removeNotablePhoto', () => {
  it('clears the claim then deletes the freed object', async () => {
    const { remove, rpc } = arrangeRemove({ data: 'game-1/abc.webp', error: null });

    expect(await removeNotablePhoto(CLAIM_ID)).toEqual({});

    expect(rpc).toHaveBeenCalledWith('clear_notable_photo', { p_claim_id: CLAIM_ID, p_actor: USER_ID });
    expect(remove).toHaveBeenCalledWith(['game-1/abc.webp']);
  });

  // The database owns this refusal, so the action only has to surface it.
  it('refuses a caller who did not log the claim, and touches no storage', async () => {
    const { remove } = arrangeRemove({ data: null, error: { message: 'not your claim' } });

    expect(await removeNotablePhoto(CLAIM_ID)).toEqual({ error: 'not your claim' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('succeeds without touching storage when the claim had no photo', async () => {
    const { remove } = arrangeRemove({ data: null, error: null });

    expect(await removeNotablePhoto(CLAIM_ID)).toEqual({});
    expect(remove).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/actions/game.test.ts -t removeNotablePhoto`
Expected: FAIL, `removeNotablePhoto is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/actions/game.ts`:

```ts
export async function removeNotablePhoto(claimId: string): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    const admin = createAdminClient();

    // No requireParticipant here on purpose: the question is not "are you at this table" but
    // "did you log this claim", and the RPC answers it inside the transaction that clears it.
    const { data: path, error } = await admin.rpc('clear_notable_photo', {
      p_claim_id: claimId,
      p_actor: user.id,
    });
    if (error) return { error: error.message };

    // Order is deliberate. Column first, object second. If the object delete then fails we are
    // left with an invisible orphan costing a little storage; the reverse order would leave a
    // claim pointing at a deleted image, which is a broken picture on somebody's screen.
    if (path) await admin.storage.from(PHOTO_BUCKET).remove([path as string]);
    return {};
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'failed to remove' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/actions/game.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/game.ts tests/actions/game.test.ts
git commit -m "feat: let the logger remove a notable-hand photo"
```

---

### Task 5: Minting signed URLs

`ChipLive` runs in the browser and re-reads claims itself, so it receives `photo_path` but cannot turn one into a URL: signing needs the service-role key, which is server-only and must stay that way. This action is the bridge.

**Files:**
- Modify: `src/lib/actions/game.ts`
- Test: `tests/actions/game.test.ts`

**Interfaces:**
- Consumes: `PHOTO_BUCKET` (Task 3)
- Produces:
  - `SIGNED_URL_TTL_SECONDS = 3600`
  - `signNotablePhotos(gameId: string): Promise<{ urls?: Record<string, string>; error?: string }>` keyed by **claim id**, not by path

- [ ] **Step 1: Write the failing tests**

Append to `tests/actions/game.test.ts`:

```ts
import { signNotablePhotos } from '../../src/lib/actions/game';

function arrangeSigning({ participant = true, rows = [] as { id: string; photo_path: string }[] } = {}) {
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?token=t`, error: null })),
    error: null,
  }));
  const claimQuery = {
    select: vi.fn(() => claimQuery),
    eq: vi.fn(() => claimQuery),
    not: vi.fn(async () => ({ data: rows, error: null })),
  };
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
  });
  mocks.createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => (table === 'notable_claims'
      ? claimQuery
      : queryReturning({ data: participant ? { seat: 'E' } : null, error: null }))),
    storage: { from: vi.fn(() => ({ createSignedUrls })) },
  });
  return { createSignedUrls };
}

describe('signNotablePhotos', () => {
  it('maps each claim id to a signed URL', async () => {
    arrangeSigning({ rows: [{ id: 'c1', photo_path: 'g1/a.webp' }, { id: 'c2', photo_path: 'g1/b.webp' }] });

    const { urls } = await signNotablePhotos(GAME_ID);

    expect(urls).toEqual({
      c1: 'https://signed.example/g1/a.webp?token=t',
      c2: 'https://signed.example/g1/b.webp?token=t',
    });
  });

  it('signs nothing when no claim has a photo', async () => {
    const { createSignedUrls } = arrangeSigning({ rows: [] });

    expect(await signNotablePhotos(GAME_ID)).toEqual({ urls: {} });
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not in the game', async () => {
    const { createSignedUrls } = arrangeSigning({ participant: false });

    const result = await signNotablePhotos(GAME_ID);

    expect(result.error).toBe('you are not in this game');
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/actions/game.test.ts -t signNotablePhotos`
Expected: FAIL, `signNotablePhotos is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/actions/game.ts`:

```ts
export const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Turn this game's stored photo paths into short-lived URLs a browser can load.
 *
 * The alternative was to grant `authenticated` read access to the bucket so the client could
 * sign its own. That is rejected: it would make the browser a direct data-store client for the
 * first time in this app, which is exactly the property every other read here preserves.
 */
export async function signNotablePhotos(
  gameId: string,
): Promise<{ urls?: Record<string, string>; error?: string }> {
  try {
    const user = await requireUser();
    const { admin } = await requireParticipant(gameId, user.id);

    const { data: rows, error } = await admin
      .from('notable_claims')
      .select('id, photo_path')
      .eq('game_id', gameId)
      .not('photo_path', 'is', null);
    if (error || !rows) return { error: 'could not read photos' };
    if (rows.length === 0) return { urls: {} };

    const paths = rows.map((row: { photo_path: string }) => row.photo_path);
    const { data: signed, error: signError } = await admin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed) return { error: 'could not sign photos' };

    const byPath = new Map(signed.map((entry) => [entry.path, entry.signedUrl]));
    const urls: Record<string, string> = {};
    for (const row of rows as { id: string; photo_path: string }[]) {
      const url = byPath.get(row.photo_path);
      // A path that failed to sign is simply omitted. A missing thumbnail is a blank space;
      // a broken one is a visible fault on a screen nobody can fix at the table.
      if (url) urls[row.id] = url;
    }
    return { urls };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'failed to sign' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/actions/game.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/game.ts tests/actions/game.test.ts
git commit -m "feat: mint signed URLs for a game's notable-hand photos"
```

---

### Task 6: Capture control in the notable logger

Bryan chose a single submit that carries the photo. The known cost is that a slow upload can take the claim with it, so the escape hatch in Step 1 is not a nicety, it is the mitigation that makes that choice safe.

**Files:**
- Modify: `src/app/game/[id]/NotableLogger.tsx` (whole file)
- Test: `tests/components/NotableLogger.test.tsx`

**Interfaces:**
- Consumes: `downscaleToWebp` (Task 1), `logNotable(..., photo?: Blob)` and `photoFailed` (Task 3)
- Produces: no new exports; the component's props are unchanged

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/NotableLogger.test.tsx`. Note the added mock of the image helper: jsdom has no real canvas, and Task 1 already tests the helper itself.

```ts
vi.mock('../../src/lib/image', () => ({
  MAX_UPLOAD_BYTES: 2 * 1024 * 1024,
  downscaleToWebp: vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/webp' })),
}));

import { downscaleToWebp } from '../../src/lib/image';

function attachPhoto() {
  const input = screen.getByLabelText('Photo of the tiles') as HTMLInputElement;
  const file = new File([new Uint8Array([9])], 'hand.heic', { type: 'image/heic' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('NotableLogger photo capture', () => {
  it('logs without a photo when none was taken', async () => {
    renderLogger();
    chooseNotable();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    expect(vi.mocked(logNotable)).toHaveBeenCalledWith('g1', 'p2', 'h1', undefined);
  });

  it('shrinks the chosen photo and sends it with the claim', async () => {
    renderLogger();
    chooseNotable();
    await act(async () => { attachPhoto(); });

    expect(vi.mocked(downscaleToWebp)).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText('Photo of the tiles you are about to log')).toBeDefined();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    const sent = vi.mocked(logNotable).mock.calls[0][3];
    expect(sent).toBeInstanceOf(Blob);
  });

  // The point of the whole mitigation: a dead upload must not cost the claim.
  it('keeps both choices and offers an escape when the upload fails', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'Could not upload the photo.', photoFailed: true });
    renderLogger();
    chooseNotable();
    await act(async () => { attachPhoto(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    expect(screen.getByText('Could not upload the photo.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Notable hand') as HTMLSelectElement).value).toBe('h1');
    expect(screen.getByRole('button', { name: 'Log it without the photo' })).toBeDefined();
  });

  it('submits the identical claim with no photo when the escape is taken', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'Could not upload the photo.', photoFailed: true });
    const onClose = renderLogger();
    chooseNotable();
    await act(async () => { attachPhoto(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log it without the photo' })); });

    expect(vi.mocked(logNotable)).toHaveBeenLastCalledWith('g1', 'p2', 'h1', undefined);
    expect(onClose).toHaveBeenCalled();
  });

  // A refused CLAIM would be refused again without the photo, so the escape must stay hidden.
  it('offers no escape when the claim itself was refused', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'game is not an active chip game' });
    renderLogger();
    chooseNotable();
    await act(async () => { attachPhoto(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    expect(screen.queryByRole('button', { name: 'Log it without the photo' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/NotableLogger.test.tsx`
Expected: FAIL, no element labelled `Photo of the tiles`.

- [ ] **Step 3: Rewrite the component**

Replace `src/app/game/[id]/NotableLogger.tsx` entirely:

```tsx
'use client';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Seat } from '../../../lib/engine/types';
import { logNotable } from '../../../lib/actions/game';
import { downscaleToWebp } from '../../../lib/image';
import { FullScreenPanel } from '../../../components/FullScreenPanel';
import { Button, LiveRegion } from '../../../components/ui';

type P = { playerId: string; seat: Seat; name: string };
type NH = { id: string; name: string; local_name: string | null };

export function NotableLogger({
  players, notableHands, gameId, syncBlocked = false, isSyncBlocked, syncError, onClose,
}: {
  players: P[];
  notableHands: NH[];
  gameId: string;
  syncBlocked?: boolean;
  isSyncBlocked?: () => boolean;
  syncError?: string;
  onClose: () => void;
}) {
  const [playerId, setPlayerId] = useState<string>();
  const [handId, setHandId] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [photo, setPhoto] = useState<Blob>();
  const [preview, setPreview] = useState<string>();
  // Revealed only when the PHOTO leg failed. A refused claim would refuse again without it.
  const [canSkipPhoto, setCanSkipPhoto] = useState(false);
  const submittingRef = useRef(false);

  // An object URL is a document-lifetime handle, not a value; without this the preview leaks
  // every time the logger is opened during a long night.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const choosePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(undefined);
    try {
      const shrunk = await downscaleToWebp(file);
      setPhoto(shrunk);
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(shrunk); });
    } catch (cause) {
      setPhoto(undefined);
      setError(cause instanceof Error ? cause.message : 'Could not read that photo. Try again.');
    }
  };

  const submit = async (withPhoto: boolean) => {
    if (submittingRef.current || isSyncBlocked?.() || !playerId || !handId) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await logNotable(gameId, playerId, handId, withPhoto ? photo : undefined);
      if (result.error) {
        setError(result.error);
        // Both choices are deliberately left standing so the escape re-sends the same claim.
        if (result.photoFailed) setCanSkipPhoto(true);
      } else onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the table. Try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <FullScreenPanel title="Log notable hand" onDismiss={onClose}>
      <div className="flex max-w-xl flex-col gap-6">
        <fieldset>
          <legend className="text-sm font-bold">Who won it?</legend>
        <div className="flex flex-wrap gap-2">
          {players.map((p) => (
              <Button key={p.playerId} variant={playerId === p.playerId ? 'primary' : 'secondary'}
                aria-pressed={playerId === p.playerId} onClick={() => setPlayerId(p.playerId)}>
              {p.name}
              </Button>
          ))}
        </div>
        </fieldset>

        <div>
          <label htmlFor="notable-hand" className="block text-sm font-bold">Notable hand</label>
          <select id="notable-hand" value={handId ?? ''}
            onChange={(event) => setHandId(event.target.value || undefined)}
            className="mt-2 min-h-11 w-full rounded-[10px] border-2 border-divider bg-surface px-3 text-ink focus:border-cobalt focus:outline-2 focus:outline-offset-2 focus:outline-cobalt">
            <option value="">Pick a hand…</option>
            {notableHands.map((hand) => (
              <option key={hand.id} value={hand.id}>{hand.name}{hand.local_name ? ` (${hand.local_name})` : ''}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="notable-photo" className="block text-sm font-bold">Photo of the tiles</label>
          <p className="mt-1 text-xs text-muted">Optional. The tiles get swept fast, so take it now if you want it.</p>
          <input id="notable-photo" type="file" accept="image/*" capture="environment"
            onChange={choosePhoto}
            className="mt-2 block w-full text-sm file:mr-3 file:min-h-11 file:rounded-[10px] file:border-2 file:border-ink file:bg-surface file:px-4 file:font-bold file:text-ink" />
          {preview ? (
            <img src={preview} alt="Photo of the tiles you are about to log"
              className="mt-3 max-h-48 rounded-[10px] border-2 border-divider object-contain" />
          ) : null}
        </div>

        <LiveRegion tone="error" message={syncError ?? error} />
        <Button className="w-full" disabled={syncBlocked || !playerId || !handId} busy={submitting}
          busyLabel={photo ? 'Uploading…' : 'Logging…'} onClick={() => submit(true)}>
          Log notable hand
        </Button>
        {canSkipPhoto ? (
          <Button className="w-full" variant="secondary" disabled={syncBlocked} busy={submitting}
            busyLabel="Logging…" onClick={() => submit(false)}>
            Log it without the photo
          </Button>
        ) : null}
      </div>
    </FullScreenPanel>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/NotableLogger.test.tsx`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/game/\[id\]/NotableLogger.tsx tests/components/NotableLogger.test.tsx
git commit -m "feat: capture a tile photo while logging a notable hand"
```

---

### Task 7: Thumbnails on the live game screen

**Files:**
- Modify: `src/app/game/[id]/ChipLive.tsx` (the claims select, a new effect, the claims list)
- Test: `tests/components/ChipLive.test.tsx`

**Interfaces:**
- Consumes: `signNotablePhotos` (Task 5)
- Produces: no new exports

> **Critical:** the signing call goes in its **own effect**, never inside `reload`. `reload` is the
> fail-closed path that decides whether chip actions are safe to offer; a photo service having a
> bad day must not be able to disable "End game". Photos are decoration.

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/ChipLive.test.tsx`. Add the mock alongside the existing action mock at the top of the file by extending it with `signNotablePhotos: vi.fn(async () => ({ urls: {} }))`, then:

```ts
import { signNotablePhotos } from '../../src/lib/actions/game';

describe('ChipLive notable-hand photos', () => {
  it('shows a thumbnail for a claim that has one', async () => {
    db.claims = [{ id: 'c1', player_id: 'p2', notable_hand_id: 'h1', photo_path: 'g1/a.webp' }];
    vi.mocked(signNotablePhotos).mockResolvedValue({ urls: { c1: 'https://signed.example/a.webp' } });

    render(view('active'));
    await flush();
    await flush();

    const img = screen.getByAltText('Thirteen Wonders won by Bryan') as HTMLImageElement;
    expect(img.src).toBe('https://signed.example/a.webp');
  });

  it('renders no placeholder for a claim without a photo', async () => {
    db.claims = [{ id: 'c1', player_id: 'p2', notable_hand_id: 'h1', photo_path: null }];

    render(view('active'));
    await flush();

    expect(screen.queryByRole('img')).toBeNull();
    expect(vi.mocked(signNotablePhotos)).not.toHaveBeenCalled();
  });

  // Photos are decoration. A signing outage must not reach the fail-closed chip guards.
  it('keeps chip actions available when signing fails', async () => {
    db.claims = [{ id: 'c1', player_id: 'p2', notable_hand_id: 'h1', photo_path: 'g1/a.webp' }];
    vi.mocked(signNotablePhotos).mockResolvedValue({ error: 'could not sign photos' });

    render(view('active'));
    await flush();
    await flush();

    expect((screen.getByRole('button', { name: 'End game · count chips' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('alert')?.textContent ?? '').not.toContain('sign');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/ChipLive.test.tsx -t "notable-hand photos"`
Expected: FAIL, no element with that alt text.

- [ ] **Step 3: Implement**

Three edits to `src/app/game/[id]/ChipLive.tsx`.

First, widen the claim type and the select (around line 14 and line 59):

```ts
type Claim = { id: string; player_id: string; notable_hand_id: string; photo_path: string | null };
```

```ts
    const { data: claimRows, error: claimsError } = await supabase.from('notable_claims')
      .select('id, player_id, notable_hand_id, photo_path').eq('game_id', gameId).order('created_at');
```

Second, add the import and a dedicated effect after the existing visibility effect:

```ts
import { signNotablePhotos } from '../../../lib/actions/game';
```

```tsx
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  // Deliberately NOT part of reload(). reload() decides whether chip actions are safe to offer,
  // and a photo service having a bad day must never be able to disable "End game". A failure
  // here costs a thumbnail and nothing else, so it is swallowed rather than surfaced.
  useEffect(() => {
    if (!claims.some((claim) => claim.photo_path)) { setPhotoUrls({}); return; }
    let cancelled = false;
    void signNotablePhotos(gameId).then((result) => {
      if (!cancelled && result.urls) setPhotoUrls(result.urls);
    });
    return () => { cancelled = true; };
  }, [claims, gameId]);
```

Third, render the thumbnail in the claims list (replacing the `<li>` body around line 195):

```tsx
              <li key={c.id} className="flex items-center gap-3 rounded-[10px] border border-divider bg-surface px-4 py-3 text-sm">
                {photoUrls[c.id] ? (
                  <img src={photoUrls[c.id]} alt={`${handName(c.notable_hand_id)} won by ${name(c.player_id)}`}
                    className="size-12 shrink-0 rounded-[8px] border border-divider object-cover" />
                ) : null}
                <span>🏆 {name(c.player_id)} — {handName(c.notable_hand_id)}</span>
              </li>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/ChipLive.test.tsx`
Expected: PASS, all 32 tests including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/app/game/\[id\]/ChipLive.tsx tests/components/ChipLive.test.tsx
git commit -m "feat: show notable-hand photo thumbnails during a chip game"
```

---

### Task 8: The archive at `/hands`

**Files:**
- Create: `src/app/hands/page.tsx` (server component)
- Create: `src/app/hands/HandsGallery.tsx` (client: full-screen view and the logger's delete)
- Modify: `src/app/page.tsx:87` (add one link beside the chip-set link)
- Test: `tests/components/HandsGallery.test.tsx`

**Interfaces:**
- Consumes: `removeNotablePhoto` (Task 4), `PHOTO_BUCKET` and `SIGNED_URL_TTL_SECONDS` (Tasks 3, 5), `FullScreenPanel`, `AppFrame`, `PageHeader`, `StatusMessage`
- Produces:
  - `type HandPhoto = { claimId: string; url: string; playerName: string; handName: string; playedAt: string; mine: boolean }`
  - `HandsGallery({ photos }: { photos: HandPhoto[] })`

> **PostgREST gotcha:** `notable_claims` has **two** foreign keys to `players` (`player_id` and
> `logged_by`). An unqualified `players(...)` embed is ambiguous and errors. Name the constraint:
> `players!notable_claims_player_id_fkey(display_name)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/HandsGallery.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HandsGallery } from '../../src/app/hands/HandsGallery';
import { removeNotablePhoto } from '../../src/lib/actions/game';

vi.mock('../../src/lib/actions/game', () => ({ removeNotablePhoto: vi.fn(async () => ({})) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const photo = (over: Partial<Parameters<typeof HandsGallery>[0]['photos'][number]> = {}) => ({
  claimId: 'c1',
  url: 'https://signed.example/a.webp',
  playerName: 'Bryan',
  handName: 'Thirteen Wonders',
  playedAt: '2026-08-20T14:00:00.000Z',
  mine: false,
  ...over,
});

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

describe('HandsGallery', () => {
  it('says so plainly when nothing has been photographed', () => {
    render(<HandsGallery photos={[]} />);
    expect(screen.getByText('No photographed hands yet.')).toBeDefined();
  });

  it('groups photos under the night they were played', () => {
    render(<HandsGallery photos={[photo(), photo({ claimId: 'c2', playedAt: '2026-08-14T10:00:00.000Z' })]} />);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
  });

  it('opens a photo full screen when tapped', () => {
    render(<HandsGallery photos={[photo()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Thirteen Wonders won by Bryan' }));

    expect(screen.getByRole('dialog', { name: 'Thirteen Wonders' })).toBeDefined();
  });

  it('offers no remove control on someone else’s photo', () => {
    render(<HandsGallery photos={[photo({ mine: false })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thirteen Wonders won by Bryan' }));

    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
  });

  it('removes a photo the viewer logged', async () => {
    render(<HandsGallery photos={[photo({ mine: true })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thirteen Wonders won by Bryan' }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove photo' })); });

    expect(vi.mocked(removeNotablePhoto)).toHaveBeenCalledWith('c1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/HandsGallery.test.tsx`
Expected: FAIL, cannot resolve `../../src/app/hands/HandsGallery`.

- [ ] **Step 3: Write the gallery client component**

Create `src/app/hands/HandsGallery.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { removeNotablePhoto } from '../../lib/actions/game';
import { FullScreenPanel } from '../../components/FullScreenPanel';
import { Button, LiveRegion, StatusMessage } from '../../components/ui';

export type HandPhoto = {
  claimId: string;
  url: string;
  playerName: string;
  handName: string;
  playedAt: string;
  /** True when the viewer logged this claim, which is who may remove its photo. */
  mine: boolean;
};

const night = (iso: string) =>
  new Date(iso).toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function HandsGallery({ photos }: { photos: HandPhoto[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<HandPhoto>();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string>();

  if (photos.length === 0) {
    return <StatusMessage tone="info">No photographed hands yet.</StatusMessage>;
  }

  const nights = new Map<string, HandPhoto[]>();
  for (const item of photos) {
    const key = night(item.playedAt);
    nights.set(key, [...(nights.get(key) ?? []), item]);
  }

  const remove = async () => {
    if (!open || removing) return;
    setRemoving(true);
    setError(undefined);
    const result = await removeNotablePhoto(open.claimId);
    setRemoving(false);
    if (result.error) { setError(result.error); return; }
    setOpen(undefined);
    router.refresh();
  };

  return (
    <>
      {[...nights.entries()].map(([label, items]) => (
        <section key={label} className="mt-7">
          <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-coral">{label}</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items.map((item) => (
              <li key={item.claimId}>
                <button type="button" onClick={() => setOpen(item)}
                  aria-label={`${item.handName} won by ${item.playerName}`}
                  className="block w-full overflow-hidden rounded-[10px] border-2 border-divider bg-surface">
                  <img src={item.url} alt="" className="aspect-square w-full object-cover" />
                  <span className="block px-3 py-2 text-left text-xs font-bold">
                    {item.playerName}
                    <span className="block font-normal text-muted">{item.handName}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {open ? (
        <FullScreenPanel title={open.handName} eyebrow={open.playerName} onDismiss={() => setOpen(undefined)}>
          <img src={open.url} alt={`${open.handName} won by ${open.playerName}`}
            className="max-h-[70svh] w-full rounded-[12px] border-2 border-divider object-contain" />
          <LiveRegion tone="error" message={error} />
          {open.mine ? (
            <Button className="mt-5 w-full" variant="destructive" busy={removing}
              busyLabel="Removing…" onClick={remove}>
              Remove photo
            </Button>
          ) : null}
        </FullScreenPanel>
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/HandsGallery.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the archive page**

Create `src/app/hands/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../lib/supabase/server';
import { createAdminClient } from '../../lib/supabase/admin';
import { PHOTO_BUCKET, SIGNED_URL_TTL_SECONDS } from '../../lib/actions/game';
import { AppFrame, PageHeader, StatusMessage } from '../../components/ui';
import { HandsGallery, type HandPhoto } from './HandsGallery';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  created_at: string;
  photo_path: string;
  logged_by: string;
  players: { display_name: string } | { display_name: string }[] | null;
  notable_hands: { name: string } | { name: string }[] | null;
};

const one = <T,>(value: T | T[] | null): T | null => (Array.isArray(value) ? value[0] ?? null : value);

export default async function HandsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  // Photos are for the people who play, never for a search engine.
  if (!user) redirect(`/login?next=${encodeURIComponent('/hands')}`);

  const admin = createAdminClient();
  // notable_claims has TWO foreign keys to players (player_id and logged_by), so the embed must
  // name the constraint or PostgREST cannot tell which relationship is meant.
  const { data, error } = await admin
    .from('notable_claims')
    .select('id, created_at, photo_path, logged_by, players!notable_claims_player_id_fkey(display_name), notable_hands(name)')
    .not('photo_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) console.error('[hands]', error.message);

  const rows = (data ?? []) as Row[];
  let photos: HandPhoto[] = [];
  if (rows.length > 0) {
    const { data: signed } = await admin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(rows.map((row) => row.photo_path), SIGNED_URL_TTL_SECONDS);
    const byPath = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl]));
    photos = rows.flatMap((row) => {
      const url = byPath.get(row.photo_path);
      if (!url) return [];
      return [{
        claimId: row.id,
        url,
        playerName: one(row.players)?.display_name ?? '?',
        handName: one(row.notable_hands)?.name ?? '?',
        playedAt: row.created_at,
        mine: row.logged_by === user.id,
      }];
    });
  }

  return (
    <AppFrame>
      <PageHeader backHref="/" title="Notable hands"
        description="Every hand worth photographing, newest first." />
      {error ? (
        <StatusMessage tone="error">Couldn’t load the archive just now. Refresh to try again.</StatusMessage>
      ) : (
        <HandsGallery photos={photos} />
      )}
    </AppFrame>
  );
}
```

- [ ] **Step 6: Add the link from the leaderboard**

In `src/app/page.tsx`, replace the single chip-set link at line 87 with both links:

```tsx
      <div className="mt-4 flex flex-wrap gap-3">
        <ActionLink href="/chips" variant="secondary">View the standard chip set</ActionLink>
        <ActionLink href="/hands" variant="secondary">Notable hands</ActionLink>
      </div>
```

- [ ] **Step 7: Verify the route builds and is gated**

Run: `npm run typecheck && npm run build`
Expected: both pass, and the route table lists `ƒ /hands` as dynamic.

- [ ] **Step 8: Commit**

```bash
git add src/app/hands tests/components/HandsGallery.test.tsx src/app/page.tsx
git commit -m "feat: add the signed-in notable-hand photo archive"
```

---

### Task 9: Whole-system verification

Nothing new is written here. This task exists because the previous eight each verified only their own slice.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: all files pass. Task 1 adds 8 tests, Task 3 adds 7, Task 4 adds 3, Task 5 adds 3, Task 6 adds 5, Task 7 adds 3, Task 8 adds 5. Baseline before this plan is **254**, so expect **288**.

- [ ] **Step 2: Typecheck, lint, build**

```bash
npm run typecheck && npm run lint && npm run build
```
Expected: typecheck clean; lint **0 errors** (the pre-existing `_props` warning in `GameLive.tsx` is known and must be the only warning); build emits the route table including `/hands`.

- [ ] **Step 3: Replay every migration from scratch**

```bash
npx supabase db reset
```
Expected: no error. This is the check that would have caught the `0004` count hazard, and it must pass **before** the local rehearsal stack is used for the multi-phone test.

- [ ] **Step 4: Manual checks that automation cannot cover**

- [ ] Photograph a hand with a real iPhone. Confirm HEIC is accepted and the thumbnail displays.
- [ ] Put the phone in airplane mode, submit, and confirm "Log it without the photo" appears and saves the claim.
- [ ] Download an uploaded photo and confirm it carries no GPS metadata (`exiftool <file> | grep -i gps` returns nothing).
- [ ] Wait out a signed URL (or shorten `SIGNED_URL_TTL_SECONDS` temporarily) and confirm the link stops working.
- [ ] Remove a photo on one phone and confirm it disappears from the archive on a second.
- [ ] Confirm `/hands` signed out redirects to sign-in rather than showing anything.

> **Known deviation from the spec.** Spec §12 lists the archive's signed-out redirect under
> *Automated*. It is verified manually here instead: `/hands` is an async Server Component whose
> redirect happens during a request this test harness does not run. Automating it would need a
> request-level test setup that does not exist in this repo, and inventing one is a larger job
> than the feature. Flagged rather than silently dropped.

- [ ] **Step 5: Commit any fixes and stop**

Do not deploy. Bryan decides when this ships, and the Realtime phone test is the higher priority.

---

## Notes for the executor

- **Never edit `supabase/migrations/0004_explicit_access_grants.sql`.** If a count assertion fails, the bug is in `0005`.
- **Never move the signing call into `reload()`** in `ChipLive`. See Task 7.
- If a task's tests pass on the first run before you have written any implementation, you have tested existing behaviour. Rewrite the test.
