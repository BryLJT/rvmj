# Handover: RVMJ notable-hand photos

**Written:** 2026-08-21, ~03:00 SGT
**For:** an engineer or agent picking this up cold
**Repo:** `/Users/bryan/Desktop/claude code/RVMJ`
**Owner:** Bryan (non-developer; he builds with AI assistance — explain, do not assume familiarity)

---

## 1. Read this first: the push is blocked, and why

**18 commits sit on local `main` (`cf2a3c5`). `origin/main` is at `fd4f60b`. Nothing is pushed. Do not push without resolving section 2.**

Pushing to `main` auto-deploys to production on Vercel. The new code reads a database column that **production does not have yet**, and it reads it inside a fail-closed guard. The result would not be a broken photo feature. It would be a **dead app**.

Mechanism, precisely:

1. `src/app/game/[id]/ChipLive.tsx:60` selects `photo_path` from `notable_claims`.
2. That column exists only in `supabase/migrations/0005_notable_photos.sql`, which has **not** been applied to the hosted database.
3. On production the query errors, so `claimsError` is truthy at line 64 and `failSync()` runs.
4. `failSync()` sets `syncState = 'failed'`, so `ready` is false.
5. Both "Log notable hand" and "End game · count chips" are `disabled={!ready}`.

Every player in every live chip game would see *"Couldn't refresh this game"* and be unable to finish a game. Bryan has a mahjong game night pending; this app is what records it.

---

## 2. The one decision Bryan owes

**Apply migration `0005` to the hosted Supabase database BEFORE pushing the code.**

He was asked at ~02:30 SGT and has not answered. Do not decide for him: it is a schema change against his production database.

The migration adds one nullable column, creates two functions, drops the old 4-argument `log_notable_claim`, and creates a private storage bucket. It is wrapped in `begin;`/`commit;` so it fully applies or fully rolls back, and it replays clean from scratch locally.

Verify hosted state before acting (this command needs the project linked and may prompt):

```bash
npx supabase migration list
```

If `0005` is absent from the remote column, the ordering hazard is live.

---

## 3. What was built

A player photographs the tiles while logging a notable hand. The photo is shrunk and re-encoded on the phone, uploaded through a server action, stored in a **private** bucket, and displayed through short-lived signed URLs. A new signed-in archive at `/hands` browses every photographed hand.

**Spec:** `docs/superpowers/specs/2026-08-21-notable-hand-photos-design.md`
**Plan:** `docs/superpowers/plans/2026-08-21-notable-hand-photos.md`
**Execution ledger (every ruling made):** `.superpowers/sdd/2026-08-21-notable-hand-photos/progress.md` — git-ignored, so it will not survive `git clean -fdx`.

### File map

| File | Role |
|---|---|
| `src/lib/image.ts` | `fitWithin`, `downscaleToWebp`, and the shared constants `MAX_EDGE` 1600, `WEBP_QUALITY` 0.82, `MAX_UPLOAD_BYTES` 2097152, `PHOTO_BUCKET` `'notable-photos'`, `SIGNED_URL_TTL_SECONDS` 3600 |
| `supabase/migrations/0005_notable_photos.sql` | `notable_claims.photo_path`, new 5-arg `log_notable_claim`, `clear_notable_photo`, the private bucket, and its own hardening block |
| `src/lib/actions/game.ts` | `logNotable` gained a photo leg; added `removeNotablePhoto` and `signNotablePhotos` |
| `src/app/game/[id]/NotableLogger.tsx` | Capture control, preview, and the "Log it without the photo" escape |
| `src/app/game/[id]/ChipLive.tsx` | Thumbnails on the live claims list |
| `src/app/hands/page.tsx` + `HandsGallery.tsx` | The archive, grouped by night |
| `next.config.*` | `serverActions.bodySizeLimit` derived from `MAX_UPLOAD_BYTES` |

---

## 4. Rules you must not break

These are not style preferences. Each one has a failure behind it.

1. **Never edit `supabase/migrations/0004_explicit_access_grants.sql`.** It normalizes protected functions **by name** and asserts it found exactly **15**. `log_notable_claim` is on that list. Adding a parameter creates a *second* function under the same name, so a from-scratch rebuild would count 16 and abort the whole chain. `0005` therefore **drops** the 4-arg version. If a count assertion ever fails, the bug is in the newer migration, never in `0004`. Changing the `15` would make rebuilds pass while proving nothing.

2. **Never edit `0005` either.** It has been applied to a database. Schema changes go in a new `0006`.

3. **Never move the `signNotablePhotos` call into `ChipLive`'s `reload()`.** `reload()` decides whether chip actions are safe to offer. A photo service having a bad day must not be able to disable "End game". Signing lives in its own `useEffect` and its failure is swallowed on purpose. There is a test asserting chip actions stay enabled when signing fails.

4. **Never export a non-async value from `src/lib/actions/game.ts`.** It begins with `'use server'`, where every export must be an async function. This is why the shared constants live in `src/lib/image.ts`. `export type` is fine only because types are erased.

5. **Never make the client-side downscale optional.** Re-encoding through a canvas strips EXIF, including GPS. Without it, every uploaded photo would disclose where the group plays. It is a privacy control that happens to also shrink the file and convert iPhone HEIC.

6. **Do not add storage RLS policies for the bucket.** There are deliberately zero. Uploads are server-mediated and reads use server-minted signed URLs, so no `anon` or `authenticated` role ever touches it. The absence is the design.

---

## 5. Verification

All of these pass as of `cf2a3c5`:

```bash
npm test          # 296 passed across 26 files
npm run typecheck # clean
npm run lint      # 0 errors, 1 pre-existing GameLive.tsx warning
npm run build     # succeeds, route table includes  ƒ /hands
npx supabase db reset   # replays 0001 -> 0005 clean from scratch
```

The `db reset` is the important one: it is what proves rule 4.1 is satisfied. Run it after any migration change.

Database objects, verified live rather than assumed:

```bash
docker exec supabase_db_RVMJ psql -U postgres -d postgres -c "
select proname, pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in ('log_notable_claim','clear_notable_photo');
select id, public from storage.buckets where id='notable-photos';
select count(*) from pg_policies where schemaname='storage';"
```

Expect `log_notable_claim` **once** with 5 args, `clear_notable_photo` with 2, the bucket private, and **zero** storage policies.

### Environment
Docker Desktop and the local Supabase stack were running when this was written. Docker needed two `open -a Docker` attempts to start. `npx supabase start` takes several minutes on a cold image pull.

---

## 6. Open work

**Blocking:**
- Section 2's decision, then push, then confirm the Vercel deployment serves the new code.

**Not blocking, surfaced rather than silently fixed:**
- No way to **clear** a chosen photo and pick a different one. After a failed upload the player gets the escape hatch but cannot swap the photo. Spec §11 asks for a "Retake" affordance; the raw file input serves it thinly.
- `canSkipPhoto` is not reset when a new photo is chosen.

**Manual checks nobody has done** (they need a real phone and cannot be automated here):
- A real iPhone photo, confirming HEIC is accepted and displays.
- Airplane mode mid-submit, confirming "Log it without the photo" appears and saves the claim.
- An uploaded photo checked for stripped GPS (`exiftool <file> | grep -i gps` should return nothing).
- A signed URL confirmed dead after its hour.
- A photo removed on one phone disappearing from the archive on another.

**Known risks flagged but not resolved:**
- Browsers that cannot encode WebP fall back to PNG, which is much larger and may trip `MAX_UPLOAD_BYTES`. The server-side `isWebp` sniff rejects it cleanly and offers the escape, so it degrades rather than breaks, but the user-facing message would be confusing.
- `createImageBitmap` may reject HEIC outright on some browsers with a raw `DOMException`. The catch handles non-`Error` rejections; do not narrow it.

---

## 7. Working with Bryan

- He is **not** a developer. Explain what things do, not how to write them. A file name or line number is never the subject of a sentence; lead with the user-visible consequence.
- He wants the reasoning, not just the output. Walk through the why before acting.
- Discuss architecture before writing code. Always.
- Nothing is decided because you proposed it. Surface the option and wait for his explicit yes — especially for anything touching production.
- Avoid em dashes in anything written for him.
