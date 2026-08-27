# RVMJ iPhone Photo Upload Reliability and Gallery Choice

**Date:** 2026-08-27
**Status:** Approved in chat by Bryan; written spec awaiting review
**Scope:** Repairing notable-hand photo preparation on iPhone and making camera/library selection explicit
**Supersedes:** The format, capture-control, logger-preview, and related verification details in §§4, 7, 11, and 12 of `2026-08-21-notable-hand-photos-design.md`; every other decision and verification requirement in that spec remains in force

## 1. Outcome

A player logging a notable hand can deliberately either take a new photo or choose an existing photo from the phone library. RVMJ prepares either source on the phone, strips its metadata, and uploads a web-displayable image safely below the existing 2 MiB limit.

The visible failure being repaired is not an oversized source photo. Bryan supplied the original iPhone HEIC that failed: it was 1,415,063 bytes at 4032×2268. RVMJ's intended 1600×900 WebP encoding measured 149,256 bytes in a real Chromium canvas run. The source and a working WebP encode both fit.

The defect is the conversion contract. The client requests WebP once, accepts whatever `canvas.toBlob()` returns, and checks only the byte count. WebKit explicitly substitutes PNG when the requested canvas encoding is unsupported. Safari and Chrome on iPhone both use WebKit. A 1600×900 PNG of the supplied scene was already near the 2 MiB ceiling, so the substitution can produce the reported “photo too large” failure. The repair must inspect what the browser actually produced, not what RVMJ requested.

Primary evidence:

- WebKit's `toEncodingMimeType` returns `image/png` for unsupported encodings: <https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLCanvasElement.cpp>
- Chrome documents that Chrome on iOS uses WebKit: <https://developer.chrome.com/docs/web-platform/blink>

## 2. Scope

### Included

- Separate **Take photo** and **Choose from library** controls
- Client-side WebP preference with verified JPEG fallback
- Adaptive quality and dimension reduction until the prepared image is safely below the upload ceiling
- Correct server-side detection, naming, and upload of WebP or JPEG bytes
- Private bucket acceptance of both `image/webp` and `image/jpeg`
- Preview replacement and removal before logging
- Resetting stale photo-failure state when a photo is replaced or removed
- Automated format, retry, UI, server-boundary, bucket, and migration-replay tests
- Real-iPhone acceptance with the supplied HEIC through both camera and library paths

### Excluded

- Increasing the 2 MiB storage limit
- Uploading the original HEIC or any original metadata
- Server-side image conversion
- Cropping, rotation controls, filters, captions, or multiple photos
- Changing the archive, signed-URL, deletion-authorization, or claim model
- Supporting PNG as an uploaded storage format

## 3. Decisions and rationale

| Decision | Rationale |
|---|---|
| **WebP first, verified JPEG fallback** | WebP keeps today's efficient output where it works. JPEG canvas encoding is broadly available on iPhone and stays compact for photographs. PNG is rejected because it is lossless and caused the size failure. |
| **Trust the returned Blob type only after checking it** | `toBlob(..., 'image/webp')` is a request, not a guarantee. A candidate is usable only when `blob.type` equals the requested format. |
| **Adapt rather than reject after one encode** | Image detail varies. A fixed quality can pass one hand and fail another. Bounded retries make the limit a property of the helper rather than luck. |
| **Keep the 2 MiB hard ceiling; target 1.5 MiB on the client** | The server, framework, and bucket already agree on 2 MiB. A 1.5 MiB client target leaves headroom, shortens table-wifi uploads, and avoids living at the boundary without changing infrastructure limits. |
| **Accept WebP and JPEG in the existing private bucket** | Existing photos remain WebP. New iPhone fallbacks can be JPEG. No new bucket, table, column, policy, or signed-URL path is needed. |
| **Detect format from magic bytes on the server** | A browser-controlled MIME declaration is not evidence. The server derives content type and extension from bytes before the first storage write. |
| **Two explicit source controls** | `capture="environment"` asks for the rear camera; omitting `capture` allows the photo library. One input cannot communicate both choices consistently. |
| **Continue re-encoding on the phone** | Canvas redraw removes EXIF/GPS and avoids sending a multi-megabyte original over table wifi. This remains a privacy boundary, not an optional optimisation. |
| **No new image library** | Native browser APIs already provide the required decode, redraw, WebP/JPEG encode, and metadata stripping. A dependency or WASM codec would add payload and failure modes without serving this scope. |

## 4. Client preparation contract

Replace `downscaleToWebp(file)` with a format-aware helper:

```ts
export type PreparedPhotoType = 'image/webp' | 'image/jpeg';

export async function preparePhoto(file: File): Promise<Blob>;
```

The returned Blob must satisfy all of these invariants:

1. `blob.type` is exactly `image/webp` or `image/jpeg`.
2. `blob.size <= TARGET_UPLOAD_BYTES`, where `TARGET_UPLOAD_BYTES = 1.5 * 1024 * 1024`.
3. Its longest edge is no greater than 1600 pixels.
4. It was produced by drawing decoded pixels to a fresh canvas; the original bytes and metadata are never returned.
5. The decoded bitmap is closed on every success or failure path.

### 4.1 Encoding sequence

Decode the selected file once with `createImageBitmap`. Draw it at the current fitted size. For each size, attempt the bounded quality ladder `0.82`, `0.72`, `0.62`, `0.52`.

At the first size:

1. Request `image/webp` at quality 0.82.
2. If the result is non-null and its type is exactly `image/webp`, WebP is supported for this operation. Continue the WebP quality ladder until a candidate meets the target.
3. If the result is null or its type is anything else, do not treat those bytes as WebP and do not continue WebP attempts. Switch to JPEG.
4. Request `image/jpeg` and require an exact `image/jpeg` result. Continue the JPEG quality ladder until a candidate meets the target.

If all qualities at 1600 pixels remain above target, redraw from the original decoded bitmap at maximum edges 1280 and then 1024, repeating the supported-format quality ladder at each size. These values are upper bounds, never upscale instructions; skip a step when `fitWithin` produces dimensions already attempted. Return the first candidate at or below target. If no candidate qualifies, throw `Could not shrink that photo enough. Choose another photo.`

The loops are finite: at most three sizes and four qualities after format support is known. A PNG fallback is discarded immediately and is never uploaded.

### 4.2 Decode and preparation failures

A null canvas context, decode failure, null JPEG result, or non-JPEG result from the JPEG fallback produces `Could not read that photo. Try another photo.` The logger preserves the selected player and notable hand. It clears any earlier prepared photo so an old preview cannot be submitted accidentally.

The helper does not inspect the source extension or declared source MIME type. HEIC, JPEG, and other phone formats succeed when the browser can decode them; unsupported formats fail through the same visible error.

## 5. Logger interface and state

The photo section keeps the label **Photo of the tiles** and the existing optional explanation. Replace the single native file control with two visible secondary buttons:

- **Take photo** activates a hidden input with `accept="image/*" capture="environment"`.
- **Choose from library** activates a separate hidden input with `accept="image/*"` and no `capture` attribute.

Both inputs call the same selection handler and therefore the same preparation path. Each input's value is cleared after reading so selecting the same file again still fires a change event.

While preparation is running:

- Show **Preparing photo…** in the live status area.
- Disable both source buttons and **Log notable hand**.
- Do not submit an unprepared original or a previously prepared photo.

After success:

- Show the existing object-URL preview.
- Either source button may replace it.
- Show a secondary **Remove photo** button. Removing revokes the preview URL, clears the prepared Blob, clears both file inputs, clears photo-specific errors, and clears `canSkipPhoto`.
- Choosing a replacement also clears `canSkipPhoto` before conversion begins. A failed upload for photo A must not leave “Log it without the photo” visible after photo B is chosen.

Object URLs remain explicitly revoked on replacement, removal, and component unmount. Player, hand, sync-blocked, submit deduplication, and the existing upload-failure escape behave exactly as today.

## 6. Server upload contract

Replace the WebP-only predicate with one format detector:

```ts
type StoredPhotoFormat = {
  contentType: 'image/webp' | 'image/jpeg';
  extension: 'webp' | 'jpg';
};

function detectStoredPhotoFormat(bytes: Uint8Array): StoredPhotoFormat | null;
```

Recognition rules:

- WebP: at least 12 bytes, bytes 0–3 are `RIFF`, bytes 8–11 are `WEBP`.
- JPEG: at least 3 bytes, bytes 0–2 are `FF D8 FF`.
- Everything else, including PNG whose Blob claims to be WebP or JPEG, returns null.

`logNotable` keeps its current order:

1. Authenticate and require game participation.
2. Reject more than 2 MiB before reading or writing storage.
3. Read bytes and detect the actual format.
4. Reject an unsupported format before storage.
5. Build `{gameId}/{uuid}.{extension}` and upload with the detector's `contentType`.
6. Record the path in the claim.
7. Remove the object if the claim write fails.

The browser-supplied `photo.type` is never used to choose the extension or upload MIME type.

## 7. Storage migration and release order

Add migration `0010_photo_upload_formats.sql`. It updates the existing `notable-photos` bucket in an explicit transaction:

- `public = false`
- `file_size_limit = 2097152`
- `allowed_mime_types = array['image/webp', 'image/jpeg']`

The migration raises if the bucket does not exist or if the final values differ. It creates no storage policy and changes no table or function grant.

This is a backward-compatible expansion. Apply and verify migration 0010 on hosted Supabase before deploying application code. The old app continues uploading WebP while the bucket accepts both types. Once the new app is live, JPEG fallback uploads become valid. No broken compatibility window is introduced.

Do not edit historical migration 0005. It remains the truthful record of the bucket created as WebP-only in August 2026; migration 0010 records the later expansion.

## 8. Size-limit invariants

The existing hard limit remains one exported constant:

```ts
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const TARGET_UPLOAD_BYTES = 1.5 * 1024 * 1024;
```

The relationship is guarded: `TARGET_UPLOAD_BYTES < MAX_UPLOAD_BYTES`. The four hard-limit layers remain aligned:

- client refuses any prepared candidate above `MAX_UPLOAD_BYTES` as a final backstop;
- `logNotable` rejects a payload above `MAX_UPLOAD_BYTES`;
- Next server-action body allowance stays strictly above `MAX_UPLOAD_BYTES`;
- the bucket stays exactly `MAX_UPLOAD_BYTES`.

The 1.5 MiB target is a preparation goal, not a second server acceptance rule. A correctly formatted payload between 1.5 and 2 MiB remains accepted by the server so compatibility is not narrowed.

## 9. Error handling

| Failure | Visible behavior | Storage effect |
|---|---|---|
| Source cannot be decoded | “Could not read that photo. Try another photo.” | None |
| Browser cannot produce verified WebP or JPEG | Same read error | None |
| All bounded retries remain too large | “Could not shrink that photo enough. Choose another photo.” | None |
| Server receives unsupported magic bytes | Existing “That file is not a supported image.” and photo escape | None |
| Server receives more than 2 MiB | Existing “That photo is too large.” and photo escape | None |
| Storage upload fails | Existing upload error and photo escape | No claim path |
| Claim write fails after upload | Existing claim error; no photo escape | Uploaded object removed |

Preparation errors happen before submission and leave the prepared-photo state empty, so the ordinary **Log notable hand** action submits no photo. **Log it without the photo** remains reserved for a photo that was actually sent and failed in flight or at the server.

## 10. Automated verification

All behavior is built test-first, with each new guard observed red before implementation.

### Image helper

- A verified WebP candidate is returned without invoking JPEG.
- A WebP request returning PNG triggers JPEG fallback; the PNG bytes are never returned.
- A verified JPEG fallback is returned with `image/jpeg`.
- An oversized candidate moves through the quality ladder in the declared order.
- Candidates still oversized at 1600 cause redraws at 1280, then 1024.
- The first qualifying candidate is returned and no later encode runs.
- Null or wrong-type JPEG results fail with the read error.
- Exhausted retries fail with the shrink error.
- The bitmap closes after success and after every failure.
- Existing `fitWithin` aspect-ratio and never-upscale guards remain green.

### Logger

- **Take photo** owns a camera input with `capture="environment"`.
- **Choose from library** owns an input with no `capture` attribute.
- Both routes call `preparePhoto` and show the resulting preview.
- Submission is disabled while preparation is pending.
- Replacing or removing a photo revokes the old object URL.
- Removing clears the Blob and submits no photo.
- Replacing a failed photo resets `canSkipPhoto`.
- The same file can be selected twice because the input value is reset.
- Existing upload escape, sync guards, and duplicate-submit tests stay green.

### Server and storage

- Existing valid WebP uploads keep the `.webp` path and `image/webp` content type.
- Valid JPEG magic receives a `.jpg` path and `image/jpeg` content type.
- PNG is rejected even when its declared Blob type says WebP or JPEG.
- Oversized and unsupported inputs still cause zero storage writes.
- Migration 0010 asserts the bucket is private, exactly 2 MiB, and accepts exactly WebP and JPEG.
- Migration replay applies 0010 in every database shape; the clean replay coverage guard matches all migrations on disk.
- The upload-limit test reads final bucket state from migration 0010 rather than rewriting history in 0005.

### Full gates

- Focused Vitest files
- Full Vitest suite
- TypeScript typecheck
- ESLint with zero errors
- Next production build
- Full database migration replay

## 11. Manual iPhone acceptance

Use a real iPhone, not desktop emulation.

1. In Safari, **Choose from library** and select the supplied `IMG_7515.heic`. Confirm preparation succeeds, preview appears, logging succeeds, and the image displays in the game and `/hands`.
2. In Safari, **Take photo**. Confirm the rear camera opens and the photo follows the same successful path.
3. Repeat the library case in Chrome on the same iPhone. Browser branding must not change the result.
4. Inspect the stored object's content type, extension, and size. It must be WebP or JPEG and no more than 2 MiB.
5. Inspect the stored file for EXIF/GPS absence.
6. Choose a photo, remove it, and log. Confirm the claim has no photo.
7. Choose photo A, replace it with photo B, and confirm only B is uploaded.
8. Repeat the existing offline-upload escape check: a failed upload must not cost the claim.

## 12. Unchanged guarantees

- One optional photo per notable claim
- Original photo never leaves the device
- Private bucket with no browser-role storage policies
- Signed URLs expire after one hour
- Only the logger may remove the photo
- A failed photo never prevents logging the claim without it
- In-game thumbnail, archive, deletion, and cross-device refresh behavior remain unchanged

## 13. Deferred

1. Server-side or WASM codecs for browsers that cannot encode JPEG
2. PNG storage support
3. User-controlled crop, rotation, or quality
4. Multiple images, captions, reactions, or comments
5. Raising the storage ceiling
