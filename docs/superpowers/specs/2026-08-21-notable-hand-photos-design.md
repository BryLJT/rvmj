# RVMJ Notable-Hand Photos

**Date:** 2026-08-21
**Status:** Approved by Bryan
**Scope:** Attaching one photo to a chip-mode notable-hand claim, plus the archive that displays them
**Origin:** Item 2 of the "Out of scope" list in `docs/handoffs/2026-08-20-forming-realtime-bug.md`

## 1. Outcome

A notable hand is currently a line of text. Somebody hits Thirteen Wonders, taps it into the app, and all that survives is a name and a hand type. The tiles themselves are swept within seconds and the moment is gone.

This feature lets the player photograph the tiles as part of logging the hand, and turns the accumulated photos into a browsable record of nights played.

Two purposes, confirmed by Bryan, and they are served by one artifact:

- **Glory.** A permanent brag attached to a name.
- **Memory.** A visual history of the group's games.

There is exactly one kind of photo: a photo of a notable hand. Photos of the table, the room, or the people are **out of scope**. Memory is served by hand photos accumulating over time, not by a second class of image.

## 2. Scope

### Included

- One photo per notable claim, captured during chip-mode logging
- Client-side downscale and re-encode before upload
- Private storage bucket, server-mediated upload
- Short-lived signed URLs minted server-side for display
- Thumbnail on the in-game notable-hands list
- New signed-in archive screen at `/hands`, newest first, grouped by night
- Deletion of a photo by the player who logged the claim
- Failure path that preserves the claim when the upload fails

### Excluded

- More than one photo per claim
- Photos attached to a game rather than a hand
- App-mode notable hands (`scoring_events`); chip mode is the only live mode
- Editing, cropping, rotating, or filtering
- Comments, reactions, or captions
- Any signed-out access to any photo
- Bulk export or download

## 3. Decisions and rationale

| Decision | Rationale |
|---|---|
| **One photo per claim** | Enforced structurally by a single nullable column, not by a check constraint. Multiple photos would turn the archive into an album and roughly double the interface. |
| **Photo is part of logging the hand** | Bryan's explicit choice. The alternative (log first, attach after) was presented with its trade-off and rejected. The coupling risk is mitigated in §8, not by changing the flow. |
| **Private bucket, no user-facing policies** | Because upload is server-mediated and viewing uses server-minted signed URLs, no ordinary role ever touches the bucket. It needs zero RLS policies for `anon` or `authenticated`. This is the same shape as every other write in this app: the browser never reaches the data store directly. |
| **Signed URLs over a public bucket** | A public bucket URL is permanent and unrevocable. Deleting the row would not un-share a saved link. Signed URLs make deletion mean something. |
| **Nullable `photo_path`** | Every claim already recorded stays valid, and a claim whose upload failed is still a real claim. A photo is an enrichment, never a precondition for glory. |
| **Downscale on the phone, not the server** | Cuts a ~4MB phone photo to roughly 300KB before it crosses a mahjong-table wifi connection. Also converts iPhone HEIC into a web-displayable format, and strips EXIF as a side effect (see §9). |
| **Delete by the logger** | The person who took the photo is the person who can un-take it. Without any delete path, the "deletion is meaningful" property bought by signed URLs would be theoretical. |

## 4. Storage design

**Bucket:** `notable-photos`, private (`public = false`).

Defence in depth at the bucket level, independent of application checks:
- `file_size_limit`: 2 MiB
- `allowed_mime_types`: `image/webp`

**Object path:** `{game_id}/{random uuid}.webp`

The name is a fresh UUID rather than the claim id, because the object is uploaded **before** the claim row exists (§7). The game id prefix keeps a game's photos together for operator inspection and makes a cascade cleanup straightforward if one is ever needed.

**Access:** no storage policies are created for `anon` or `authenticated`. Only `service_role` reads or writes this bucket, and only from server code.

## 5. Data model

Migration `0005_notable_photos.sql`.

```
alter table notable_claims add column photo_path text;
```

Nullable, no default. One column means one photo, structurally.

`log_notable_claim` gains a `p_photo_path text` parameter. The existing four-parameter function (defined in `0001`, replaced in `0002`) must be **dropped explicitly**, not merely replaced: adding a parameter creates a second overload rather than superseding the first. Beyond call ambiguity, leaving both breaks a migration replay outright. See §6.1.

A new function `clear_notable_photo(p_claim_id uuid, p_actor uuid)` nulls the column, asserting that `p_actor = logged_by`. The authorization check lives in the database, not only in the server action, matching how every other write in this schema defends itself.

## 6. Migration constraints (read before writing the migration)

Migration `0004_explicit_access_grants.sql` is a hardening migration. It revokes PostgreSQL's permissive defaults so **new functions have no EXECUTE grant unless one is written deliberately**, and it ends with assertion blocks that **raise an exception** when access differs from the intended set.

Two of its mechanics constrain this work directly. Both were read from the file, not assumed.

### 6.1 The fixed count of 15 (the replay hazard)

`0004`'s normalize loop matches protected functions **by name only**, then asserts the count:

```sql
and p.proname in ( ..., 'log_notable_claim', ... )
...
if v_count <> 15 then
  raise exception 'expected to normalize 15 protected functions, found %', v_count;
```

`log_notable_claim` is on that list. Adding a parameter creates a **second overload under the same name**, so a database rebuilt from migrations would match sixteen rows and `0004` would abort.

Therefore:

- **`0005` must `drop function log_notable_claim(uuid, uuid, uuid, uuid)` explicitly** before creating the new signature. This is required for the migration chain to stay replayable, not a matter of tidiness.
- **The literal `15` in `0004` must not be edited.** It is a point-in-time assertion about the world as `0004` found it. `clear_notable_photo` does not exist at that point in the chain, so the count remains correct.

This matters concretely: RVMJ's local test stack is rebuilt from migrations, and a multi-phone rehearsal is pending on it. A missed drop surfaces there as an unrelated-looking failure.

### 6.2 `0005` carries its own hardening

An applied migration cannot be extended, so `0005` mirrors `0004`'s pattern for the objects it introduces:

1. Revoke all privileges on the new `log_notable_claim` and on `clear_notable_photo` from `public`, `anon`, `authenticated`
2. Grant EXECUTE to `service_role, postgres` only
3. Assert, in `0005` itself, that `anon` and `authenticated` hold no EXECUTE and `service_role` does

A hardening check that silently ignores new objects stops being a hardening check.

### 6.3 What does not change

Adding a column to `notable_claims` does not alter table-level privileges, so `0004`'s existing table and view assertions continue to hold untouched. No grant on `notable_claims` needs revisiting.

### 6.4 Storage is a different schema

Bucket access is governed by RLS on `storage.objects`, which `0004`'s `public`-schema grants do not reach. Because only `service_role` ever touches this bucket, `0005` creates **no storage policies at all**. The absence is the design, and it should be stated in a comment so a later reader does not "fix" it by adding one.

## 7. Upload flow

Single submit, per Bryan's chosen flow.

**On the phone, before anything is sent:**

1. Capture via `<input type="file" accept="image/*" capture="environment">`
2. Decode into an image, draw to a canvas at a maximum edge of 1600px, re-encode as WebP at quality 0.82
3. The result is the only thing that ever leaves the device. The original is never uploaded.

**On the server, in `logNotable`:**

1. `requireUser()` then `requireParticipant(gameId, user.id)`, exactly as today
2. Validate the received bytes: size within limit, and content **sniffed from magic bytes** rather than trusted from the declared type. A server action receives whatever the network sends; the declared type guarantees nothing.
3. Upload to `notable-photos` under a fresh UUID path using the admin client
4. Call `log_notable_claim` with the path
5. **If step 4 fails, delete the object just uploaded.** No orphans from a failed claim.

Steps 1 and 2 reject before any storage write, so a hostile caller cannot fill the bucket.

## 8. Failure handling

The known risk of the chosen flow is that a slow or dropped connection during upload takes the claim down with it. Two mitigations, both required:

**Shrink first.** The upload is roughly 300KB rather than 4MB, which is the difference between a moment and a stall on table wifi.

**Offer the escape.** When the upload leg fails, the logger does **not** reset. The chosen player and hand stay selected, an error explains what happened, and a second button appears: **"Log it without the photo"**, which submits the identical claim with a null path. A bad connection costs one extra tap, never the claim.

The existing sync guards are untouched. If the live table connection has failed, the logger stays blocked exactly as it does today; a photo does not become a way around a stale view.

## 9. Viewing flow

Signed URLs are minted server-side with the admin client and expire after **1 hour**, ample for a page view and short enough that a leaked URL is not a lasting exposure.

**Archive `/hands`** is a server component. It requires a session and redirects to `/login?next=/hands` when absent, matching `/game/[id]`. It reads claims joined to games, players, and notable hands, newest first, limited to 60, and mints all signed URLs in one batched call.

**In-game thumbnails** are a distinct problem. `ChipLive` re-reads claims in the browser and therefore receives `photo_path` but cannot mint a URL: minting needs the service role, which is server-only and must stay that way.

Resolution: a participant-checked server action `signNotablePhotos(gameId)` returns a map of claim id to signed URL. `ChipLive` calls it after each successful reload. This costs one extra round trip and keeps the rule that the browser never holds a privileged credential. Granting `authenticated` direct bucket access would remove the round trip and is **rejected**: it would make the browser a direct data-store client for the first time in this app.

**EXIF.** Phone photos carry GPS coordinates. Re-encoding through a canvas discards all metadata as a side effect, so an uploaded photo cannot disclose where the group plays. This is a consequence of the downscale step, not a separate feature, and it is a reason the downscale is **not** optional.

## 10. Deletion

Server action `removeNotablePhoto(claimId)`:

1. `requireUser()`
2. Call `clear_notable_photo(claimId, user.id)`, which asserts the caller is `logged_by` and nulls the column
3. Only then delete the storage object

**Order is deliberate.** If the column is nulled and the object delete then fails, the result is an invisible orphan that costs a little storage. If the object were deleted first and the column update failed, the result is a claim pointing at a dead image. An orphan is strictly better than a broken link.

The claim itself survives. Deleting a photo removes the picture, never the glory.

## 11. Screen design

**Notable logger.** Below the existing hand picker, a capture control showing either "Add a photo of the tiles" or the chosen photo as a preview with a "Retake" affordance. Submit remains one button. Busy label becomes "Uploading…" while the photo is in flight, then "Logging…".

**In-game list.** Each trophy line gains a small square thumbnail at its leading edge. Lines without a photo keep their current appearance exactly; no placeholder box, no empty frame.

**Archive.** Reached from the leaderboard. Grouped by night with a date heading, each entry showing the photo, the player's name, and the hand. Tapping a photo opens it full-screen in the existing `FullScreenPanel`. A photo the viewer logged shows a "Remove photo" action inside that panel.

**Empty and failed states** follow the existing `StatusMessage` conventions. An archive with no photos yet says so plainly rather than rendering an empty grid.

## 12. Verification

### Automated

Guards are written test-first, RED observed before each.

- A non-participant is rejected before any storage write
- An oversized payload is rejected before any storage write
- A payload whose magic bytes are not WebP is rejected, even when its declared type says otherwise
- A failed claim insert deletes the object that was already uploaded
- "Log it without the photo" saves the identical claim with a null path
- The chosen player and hand survive an upload failure
- `clear_notable_photo` refuses an actor who is not `logged_by`
- Deletion nulls the column before touching storage
- `signNotablePhotos` refuses a non-participant
- The archive redirects a signed-out visitor to login
- A claim with no photo renders no placeholder
- The downscale helper caps the longest edge and outputs WebP
- `0005`'s own assertion passes with the new functions present, and fails if a grant is removed
- **A database rebuilt from every migration in order succeeds.** This is the test that catches the §6.1 replay hazard, and it must run before the local rehearsal stack is rebuilt, not after

### Manual

- A real photo from an iPhone, confirming HEIC is accepted and displays
- A photo taken with the phone deliberately offline, confirming the escape hatch
- An uploaded photo checked for stripped GPS metadata
- A signed URL confirmed to stop working after expiry
- Deletion confirmed to remove the image from the archive on a second device

## 13. Deferred

Recorded so they are not silently reintroduced:

1. App-mode notable hands, which live in `scoring_events` and have no claim row
2. More than one photo per hand
3. Game-level or people photos, and the consent questions they carry
4. Captions, reactions, comments
5. Operator moderation beyond the logger's own delete
6. Orphan sweeping for objects left by a failed storage delete
