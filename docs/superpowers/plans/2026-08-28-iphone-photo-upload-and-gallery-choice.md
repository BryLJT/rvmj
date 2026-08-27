# RVMJ iPhone Photo Upload and Gallery Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let iPhone users reliably prepare and upload notable-hand photos from either the camera or photo library without PNG fallback crossing the 2 MiB limit.

**Architecture:** Keep preparation on the phone so the original and its EXIF/GPS metadata never leave the device. Prefer verified WebP, fall back to verified JPEG when WebKit substitutes PNG, and retry a finite quality/size ladder to a 1.5 MiB target. Expand the existing private bucket and server boundary to accept magic-byte-verified WebP or JPEG while keeping the 2 MiB hard ceiling and every existing claim, signing, and deletion guarantee.

**Tech Stack:** Next.js 16 server actions, React 19, TypeScript, browser Canvas APIs, Supabase Storage/Postgres migrations, Vitest + Testing Library, Bash/PostgreSQL migration harness

**Spec:** `docs/superpowers/specs/2026-08-27-iphone-photo-upload-and-gallery-choice-design.md`

## Global Constraints

- No hosted Supabase mutation, GitHub push, or production deploy during this plan; release is a separate Bryan approval gate.
- Keep `notable-photos` private with zero `anon` or `authenticated` storage policies.
- Keep `MAX_UPLOAD_BYTES = 2 * 1024 * 1024`; client preparation targets `1.5 * 1024 * 1024` but the server continues accepting valid files up to 2 MiB.
- Existing WebP objects and signed URLs must keep working.
- The original phone file must never be uploaded; every upload comes from a fresh canvas encoding.
- Uploaded bytes may be only verified `image/webp` or verified `image/jpeg`; PNG is never stored.
- Do not edit historical migration `0005_notable_photos.sql`; record the format expansion in `0010_photo_upload_formats.sql`.
- Use TDD for every behavior change: write one failing test, observe the expected failure, implement the minimum, and rerun green.
- Preserve player/hand selection, sync guards, duplicate-submit protection, photo-failure escape, object cleanup after claim failure, signed-URL behavior, and logger-only deletion.
- No new image-processing dependency.

## File Structure

- Create `supabase/migrations/0010_photo_upload_formats.sql`: expand and assert final private-bucket format settings.
- Modify `tests/database/run-migrations.sh`: apply 0010 in every database shape and assert final bucket behavior.
- Modify `tests/upload-limits.test.ts`: point the cross-layer hard-limit guard at final migration state.
- Modify `src/lib/actions/game.ts`: derive stored format, extension, and content type from WebP/JPEG magic bytes.
- Modify `tests/actions/game.test.ts`: guard WebP compatibility, JPEG acceptance, and declared-type spoof rejection.
- Modify `src/lib/image.ts`: replace one-shot WebP conversion with verified adaptive WebP/JPEG preparation.
- Modify `tests/components/image.test.ts`: guard fallback, retry order, dimension reduction, termination, and bitmap cleanup.
- Modify `src/app/game/[id]/NotableLogger.tsx`: expose camera/library actions and correct preview/preparation state.
- Modify `tests/components/NotableLogger.test.tsx`: guard both inputs, preparation blocking, replacement/removal, and stale escape reset.

---

### Task 1: Expand the Private Bucket Contract

**Files:**
- Create: `supabase/migrations/0010_photo_upload_formats.sql`
- Modify: `tests/database/run-migrations.sh`
- Modify: `tests/upload-limits.test.ts`

**Interfaces:**
- Consumes: existing bucket `notable-photos` created by migration 0005
- Produces: final bucket state `public=false`, `file_size_limit=2097152`, `allowed_mime_types={image/webp,image/jpeg}`

- [ ] **Step 1: Write the failing migration-replay guard**

In `tests/database/run-migrations.sh`, add these exact lines immediately after the matching `0009_grant_year_functions.sql` application:

```bash
apply rvmj_clean 0010_photo_upload_formats.sql
apply rvmj_hosted_shape 0010_photo_upload_formats.sql
apply rvmj_supabase_baseline 0010_photo_upload_formats.sql
apply rvmj_house 0010_photo_upload_formats.sql
apply rvmj_chip_end 0010_photo_upload_formats.sql
apply rvmj_races 0010_photo_upload_formats.sql
```

Each line belongs in its own database-shape block; do not place the six lines together.

Replace the clean bucket assertion with behavior against the replayed database:

```bash
must test "$(scalar rvmj_clean "select b.public::text || '|' || b.file_size_limit::text || '|' || array_to_string(b.allowed_mime_types, ',') from storage.buckets b where b.id = 'notable-photos'")" = "false|2097152|image/webp,image/jpeg"
```

In `tests/upload-limits.test.ts`, read migration 0010 beside migration 0005 and make the storage test assert that 0010 preserves `2097152` while adding both MIME types:

```ts
const formatMigration = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/0010_photo_upload_formats.sql', import.meta.url)),
  'utf8',
);

it('keeps the expanded storage bucket at the shared hard limit', () => {
  expect(formatMigration).toContain('file_size_limit = 2097152');
  expect(formatMigration).toContain("allowed_mime_types = array['image/webp', 'image/jpeg']");
  expect(MAX_UPLOAD_BYTES).toBe(2097152);
});
```

The database harness is the authoritative behavior test; the Node test is the cross-file drift guard that already exists for Next's body limit.

- [ ] **Step 2: Run the database harness to verify RED**

Run:

```bash
bash tests/database/run-migrations.sh
```

Expected: FAIL because `supabase/migrations/0010_photo_upload_formats.sql` does not exist. This proves the replay includes the new contract before it is implemented.

- [ ] **Step 3: Add the transactional bucket-expansion migration**

Create `supabase/migrations/0010_photo_upload_formats.sql`:

```sql
-- 0010 — accept verified JPEG fallbacks for notable-hand photos
begin;

do $$
declare
  v_updated integer;
begin
  update storage.buckets
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/webp', 'image/jpeg']
  where id = 'notable-photos';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'expected exactly one notable-photos bucket, updated %', v_updated;
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'notable-photos'
      and public = false
      and file_size_limit = 2097152
      and allowed_mime_types = array['image/webp', 'image/jpeg']
  ) then
    raise exception 'notable-photos bucket format expansion did not stick';
  end if;
end $$;

commit;
```

Do not create a storage policy or alter a public-schema grant.

- [ ] **Step 4: Run focused and database verification GREEN**

Run:

```bash
npm test -- tests/upload-limits.test.ts
bash tests/database/run-migrations.sh
```

Expected: both PASS; migration coverage reports no gap and the replayed bucket exposes exactly WebP + JPEG at 2 MiB.

- [ ] **Step 5: Commit the storage contract**

```bash
git add supabase/migrations/0010_photo_upload_formats.sql tests/database/run-migrations.sh tests/upload-limits.test.ts
git commit -m "feat(db): allow verified JPEG hand photos"
```

---

### Task 2: Detect and Store WebP or JPEG on the Server

**Files:**
- Modify: `tests/actions/game.test.ts`
- Modify: `src/lib/actions/game.ts`

**Interfaces:**
- Consumes: `Blob` received by `logNotable`
- Produces: `{ contentType: 'image/webp' | 'image/jpeg'; extension: 'webp' | 'jpg' }` derived only from bytes

- [ ] **Step 1: Write failing JPEG boundary tests**

Add a literal JPEG fixture next to `webpBytes`:

```ts
function jpegBytes(payload = 32): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(3 + payload);
  bytes.set([0xff, 0xd8, 0xff], 0);
  return bytes;
}
```

Add these tests inside `describe('logNotable photo leg')`:

```ts
it('stores JPEG bytes with a jpg path and JPEG content type', async () => {
  const { upload, rpc } = arrangeNotable();

  expect(await logNotable(GAME_ID, OTHER_ID, HAND_ID, new Blob([jpegBytes()], { type: 'image/jpeg' }))).toEqual({});

  const [path, , options] = upload.mock.calls[0];
  expect(path).toMatch(new RegExp(`^${GAME_ID}/[0-9a-f-]{36}\\.jpg$`));
  expect(options).toEqual({ contentType: 'image/jpeg' });
  expect(rpc).toHaveBeenCalledWith('log_notable_claim', expect.objectContaining({ p_photo_path: path }));
});

it('rejects PNG bytes even when the blob claims to be JPEG', async () => {
  const { upload } = arrangeNotable();
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])], { type: 'image/jpeg' });

  const result = await logNotable(GAME_ID, OTHER_ID, HAND_ID, png);

  expect(result).toEqual({ error: 'That file is not a supported image.', photoFailed: true });
  expect(upload).not.toHaveBeenCalled();
});
```

Keep the existing WebP path/content-type test unchanged as the backward-compatibility guard.

- [ ] **Step 2: Run the action tests to verify RED**

```bash
npm test -- tests/actions/game.test.ts
```

Expected: the JPEG acceptance test FAILS with the unsupported-image result; the PNG rejection and existing WebP tests remain green.

- [ ] **Step 3: Replace the WebP-only predicate with a byte-derived detector**

In `src/lib/actions/game.ts`, replace `isWebp` with:

```ts
type StoredPhotoFormat = {
  contentType: 'image/webp' | 'image/jpeg';
  extension: 'webp' | 'jpg';
};

function detectStoredPhotoFormat(bytes: Uint8Array): StoredPhotoFormat | null {
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  return null;
}
```

In `logNotable`, derive and use it:

```ts
const bytes = new Uint8Array(await photo.arrayBuffer());
const format = detectStoredPhotoFormat(bytes);
if (!format) {
  return { error: 'That file is not a supported image.', photoFailed: true };
}
const candidate = `${gameId}/${crypto.randomUUID()}.${format.extension}`;
const { error: uploadError } = await admin.storage.from(PHOTO_BUCKET)
  .upload(candidate, bytes, { contentType: format.contentType });
```

Do not read `photo.type` for validation, naming, or upload metadata.

- [ ] **Step 4: Run action tests GREEN**

```bash
npm test -- tests/actions/game.test.ts
```

Expected: PASS, including the existing WebP, oversize-before-write, orphan cleanup, and claim-vs-photo failure guards.

- [ ] **Step 5: Commit the server boundary**

```bash
git add src/lib/actions/game.ts tests/actions/game.test.ts
git commit -m "fix: accept verified JPEG hand photos"
```

---

### Task 3: Prepare Photos Adaptively in the Browser

**Files:**
- Modify: `tests/components/image.test.ts`
- Modify: `src/lib/image.ts`

**Interfaces:**
- Consumes: browser-decodable `File`
- Produces: `preparePhoto(file: File): Promise<Blob>` returning verified WebP/JPEG at no more than 1.5 MiB and 1600px longest edge

- [ ] **Step 1: Replace the one-result canvas stub with an encode queue**

In `tests/components/image.test.ts`, replace `toBlobResult` with an ordered queue and capture each actual request:

```ts
type EncodeCall = { type: string | undefined; quality: number | undefined; width: number; height: number };
const encodeCalls: EncodeCall[] = [];
let toBlobResults: Array<Blob | null>;
const bitmapClose = vi.fn();

beforeEach(() => {
  toBlobResults = [new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })];
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4032, height: 3024, close: bitmapClose })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb, type, quality) {
    encodeCalls.push({ type, quality, width: this.width, height: this.height });
    cb(toBlobResults.shift() ?? null);
  });
});
```

Reset `encodeCalls`, `bitmapClose`, and `drawImage` after each test.

- [ ] **Step 2: Write failing preparation-contract tests**

Import `preparePhoto` and add focused tests that name the production break they catch:

```ts
it('returns verified WebP without asking for JPEG', async () => {
  const blob = await preparePhoto(new File([new Uint8Array([9])], 'hand.heic', { type: 'image/heic' }));
  expect(blob.type).toBe('image/webp');
  expect(encodeCalls).toEqual([{ type: 'image/webp', quality: 0.82, width: 1600, height: 1200 }]);
});

it('discards a WebKit PNG fallback and returns verified JPEG', async () => {
  toBlobResults = [
    new Blob([new Uint8Array([1])], { type: 'image/png' }),
    new Blob([new Uint8Array([2])], { type: 'image/jpeg' }),
  ];
  const blob = await preparePhoto(new File([new Uint8Array([9])], 'hand.heic'));
  expect(blob.type).toBe('image/jpeg');
  expect(encodeCalls.map(({ type, quality }) => [type, quality])).toEqual([
    ['image/webp', 0.82],
    ['image/jpeg', 0.82],
  ]);
});

it('lowers quality before reducing dimensions', async () => {
  const tooLarge = () => new Blob([new Uint8Array(1.5 * 1024 * 1024 + 1)], { type: 'image/webp' });
  toBlobResults = [tooLarge(), tooLarge(), tooLarge(), tooLarge(), new Blob([new Uint8Array([1])], { type: 'image/webp' })];
  await preparePhoto(new File([new Uint8Array([9])], 'detail.jpg'));
  expect(encodeCalls).toEqual([
    { type: 'image/webp', quality: 0.82, width: 1600, height: 1200 },
    { type: 'image/webp', quality: 0.72, width: 1600, height: 1200 },
    { type: 'image/webp', quality: 0.62, width: 1600, height: 1200 },
    { type: 'image/webp', quality: 0.52, width: 1600, height: 1200 },
    { type: 'image/webp', quality: 0.82, width: 1280, height: 960 },
  ]);
});

it('rejects when JPEG fallback is not actually JPEG', async () => {
  toBlobResults = [new Blob([new Uint8Array([1])], { type: 'image/png' }), null];
  await expect(preparePhoto(new File([new Uint8Array([9])], 'x.heic')))
    .rejects.toThrow('Could not read that photo');
});

it('stops after bounded retries and closes the bitmap', async () => {
  toBlobResults = Array.from({ length: 12 }, () =>
    new Blob([new Uint8Array(1.5 * 1024 * 1024 + 1)], { type: 'image/webp' }));
  await expect(preparePhoto(new File([new Uint8Array([9])], 'detail.jpg')))
    .rejects.toThrow('Could not shrink that photo enough');
  expect(encodeCalls).toHaveLength(12);
  expect(bitmapClose).toHaveBeenCalledOnce();
});
```

Also keep the existing `fitWithin` tests and add a success assertion that `bitmapClose` is called once.

- [ ] **Step 3: Run the image tests to verify RED**

```bash
npm test -- tests/components/image.test.ts
```

Expected: FAIL because `preparePhoto` is not exported and the one-shot helper cannot follow the fallback/retry contract.

- [ ] **Step 4: Implement finite verified preparation**

In `src/lib/image.ts`:

```ts
export const MAX_EDGE = 1600;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const TARGET_UPLOAD_BYTES = 1.5 * 1024 * 1024;

const RETRY_EDGES = [MAX_EDGE, 1280, 1024] as const;
const RETRY_QUALITIES = [0.82, 0.72, 0.62, 0.52] as const;
const READ_ERROR = 'Could not read that photo. Try another photo.';
const SHRINK_ERROR = 'Could not shrink that photo enough. Choose another photo.';
export type PreparedPhotoType = 'image/webp' | 'image/jpeg';

function encode(canvas: HTMLCanvasElement, type: PreparedPhotoType, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}
```

Replace `downscaleToWebp` with `preparePhoto`. Decode once; for each unique fitted dimension, resize the canvas, draw from the original bitmap, and run the quality ladder. Probe WebP first. If that first result is null or not `image/webp`, switch to JPEG and require every JPEG result to be exactly `image/jpeg`. Once WebP is verified, stay on WebP for all later retries. Return the first Blob at or below `TARGET_UPLOAD_BYTES`; after all unique dimensions and qualities, throw `SHRINK_ERROR`. Translate unknown decode/draw/encode failures to `READ_ERROR`, preserve the two deliberate messages, and close the bitmap in `finally`.

The core loop must follow this exact shape:

```ts
let selectedType: PreparedPhotoType | undefined;
const attemptedSizes = new Set<string>();
for (const maxEdge of RETRY_EDGES) {
  let firstQualityAlreadyTried = false;
  const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const sizeKey = `${size.width}x${size.height}`;
  if (attemptedSizes.has(sizeKey)) continue;
  attemptedSizes.add(sizeKey);
  canvas.width = size.width;
  canvas.height = size.height;
  context.drawImage(bitmap, 0, 0, size.width, size.height);

  if (!selectedType) {
    const webp = await encode(canvas, 'image/webp', RETRY_QUALITIES[0]);
    if (webp?.type === 'image/webp') {
      selectedType = 'image/webp';
      firstQualityAlreadyTried = true;
      if (webp.size <= TARGET_UPLOAD_BYTES) return webp;
    } else {
      selectedType = 'image/jpeg';
    }
  }

  const start = firstQualityAlreadyTried ? 1 : 0;
  for (let index = start; index < RETRY_QUALITIES.length; index += 1) {
    const candidate = await encode(canvas, selectedType, RETRY_QUALITIES[index]);
    if (!candidate || candidate.type !== selectedType) throw new Error(READ_ERROR);
    if (candidate.size <= TARGET_UPLOAD_BYTES) return candidate;
  }
}
throw new Error(SHRINK_ERROR);
```

Because `firstQualityAlreadyTried` resets inside the dimension loop, a verified WebP path restarts at quality 0.82 after each redraw rather than permanently skipping it after the first canvas.

- [ ] **Step 5: Run image tests GREEN and mutation-check the fallback**

```bash
npm test -- tests/components/image.test.ts
```

Expected: PASS. Temporarily treat any WebP request result as WebP; confirm the PNG-fallback test fails. Restore the correct type check and rerun green.

- [ ] **Step 6: Commit adaptive preparation**

```bash
git add src/lib/image.ts tests/components/image.test.ts
git commit -m "fix: prepare iPhone photos with JPEG fallback"
```

---

### Task 4: Add Camera and Library Controls with Safe Preview State

**Files:**
- Modify: `tests/components/NotableLogger.test.tsx`
- Modify: `src/app/game/[id]/NotableLogger.tsx`

**Interfaces:**
- Consumes: `preparePhoto(file)` from Task 3
- Produces: explicit camera/library selection, a prepared Blob preview, replacement/removal, and unchanged `logNotable` submission

- [ ] **Step 1: Update the test mock to the new preparation interface**

Replace the `downscaleToWebp` mock/import with `preparePhoto`. Add stable URL spies in `beforeEach`:

```ts
const createObjectURL = vi.fn(() => `blob:preview-${createObjectURL.mock.calls.length + 1}`);
const revokeObjectURL = vi.fn();

vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
```

Restore the global in `afterEach`.

- [ ] **Step 2: Write failing source-control and state tests**

Add helpers that attach a literal HEIC File to either hidden input by accessible label. Add tests:

```ts
it('offers separate rear-camera and photo-library sources', () => {
  renderLogger();
  const camera = screen.getByLabelText('Take photo using camera');
  const library = screen.getByLabelText('Choose photo from library');
  expect(camera.getAttribute('accept')).toBe('image/*');
  expect(camera.getAttribute('capture')).toBe('environment');
  expect(library.getAttribute('accept')).toBe('image/*');
  expect(library.hasAttribute('capture')).toBe(false);
  expect(screen.getByRole('button', { name: 'Take photo' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Choose from library' })).toBeDefined();
});

it('blocks logging while the chosen photo is being prepared', async () => {
  let release!: (blob: Blob) => void;
  vi.mocked(preparePhoto).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  renderLogger();
  chooseNotable();
  attachLibraryPhoto();
  expect(screen.getByText('Preparing photo…')).toBeDefined();
  expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => release(new Blob([new Uint8Array([1])], { type: 'image/jpeg' })));
});

it('removes a prepared photo and submits no photo', async () => {
  renderLogger();
  chooseNotable();
  await act(async () => attachLibraryPhoto());
  fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })));
  expect(logNotable).toHaveBeenLastCalledWith('g1', 'p2', 'h1', undefined);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
});

it('replacing a failed photo hides the stale no-photo escape', async () => {
  vi.mocked(logNotable).mockResolvedValueOnce({ error: 'Could not upload the photo.', photoFailed: true });
  renderLogger();
  chooseNotable();
  await act(async () => attachLibraryPhoto());
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })));
  expect(screen.getByRole('button', { name: 'Log it without the photo' })).toBeDefined();
  await act(async () => attachCameraPhoto());
  expect(screen.queryByRole('button', { name: 'Log it without the photo' })).toBeNull();
});
```

Also assert each input value is reset after selection so a same-file change can fire again, and preserve the existing preview/submission and upload-escape tests under the renamed helper.

- [ ] **Step 3: Run logger tests to verify RED**

```bash
npm test -- tests/components/NotableLogger.test.tsx
```

Expected: FAIL because the component still exposes one captured input, imports `downscaleToWebp`, has no preparation state, and has no remove control.

- [ ] **Step 4: Implement the two-source logger UI**

In `NotableLogger.tsx`:

- Import `preparePhoto`.
- Add `preparingPhoto` state and camera/library input refs.
- Keep two hidden file inputs with these exact accessible names and capture attributes.
- Render secondary `Button`s named **Take photo** and **Choose from library** that call the corresponding input's `.click()`.
- Clear `event.currentTarget.value` immediately after reading the File.
- Before awaiting preparation: clear error, clear `canSkipPhoto`, clear the old prepared Blob/preview, and set `preparingPhoto=true`.
- On success: store only the prepared Blob and create its object URL.
- On failure: keep photo/preview empty and show the helper message.
- In `finally`: clear `preparingPhoto`.
- Disable both source buttons and the submit action while preparing.
- Use the existing `LiveRegion` with info tone for **Preparing photo…** and error tone for sync/preparation/submission errors.
- Show **Remove photo** only when a prepared photo exists. Removal clears Blob, preview, both input values, error, and `canSkipPhoto`.
- Let the existing `useEffect` cleanup revoke each preview URL on replacement, removal, and unmount; do not also revoke the same URL inside the state setter.

The state reset helper should be ordinary component code, not exported test-only API:

```ts
const clearPhoto = () => {
  setPhoto(undefined);
  setPreview(undefined);
  if (cameraInputRef.current) cameraInputRef.current.value = '';
  if (libraryInputRef.current) libraryInputRef.current.value = '';
  setCanSkipPhoto(false);
  setError(undefined);
};
```

The submit button becomes:

```tsx
<Button className="w-full"
  disabled={syncBlocked || preparingPhoto || !playerId || !handId}
  busy={submitting}
  busyLabel={photo ? 'Uploading…' : 'Logging…'}
  onClick={() => submit(true)}>
  Log notable hand
</Button>
```

- [ ] **Step 5: Run logger tests GREEN and preserve adjacent behavior**

```bash
npm test -- tests/components/NotableLogger.test.tsx tests/components/ChipLive.test.tsx
```

Expected: PASS. The ChipLive test ensures the logger's surrounding live-game photo behavior remains intact.

- [ ] **Step 6: Commit the explicit photo-source UI**

```bash
git add 'src/app/game/[id]/NotableLogger.tsx' tests/components/NotableLogger.test.tsx
git commit -m "feat: choose camera or library for hand photos"
```

---

### Task 5: Full Verification and Release-Readiness Handoff

**Files:**
- Modify only if verification exposes a defect, and then return to a failing focused test before changing production code

**Interfaces:**
- Consumes: Tasks 1–4
- Produces: a locally verified branch ready for separate hosted migration and release approval

- [ ] **Step 1: Run all focused photo tests together**

```bash
npm test -- tests/components/image.test.ts tests/components/NotableLogger.test.tsx tests/actions/game.test.ts tests/upload-limits.test.ts
```

Expected: PASS with no unhandled errors or warnings.

- [ ] **Step 2: Run the full automated gate set**

```bash
npm test
npm run typecheck
npm run lint
npm run build
bash tests/database/run-migrations.sh
git diff --check
```

Expected: every command exits 0. Lint may show only the already-known untouched `GameLive.tsx` warning; zero lint errors.

- [ ] **Step 3: Inspect the complete branch diff against the spec base**

```bash
git diff --stat 3eea023...HEAD
git diff --check 3eea023...HEAD
git log --oneline --decorate 3eea023..HEAD
git status --short --branch
```

Confirm only the files named by this plan changed, every task is committed, and the worktree is clean.

- [ ] **Step 4: Review the completed change against the spec**

Read the complete `3eea023...HEAD` diff with a fresh context and check security boundaries, format/type consistency, preview lifecycle, retry termination, storage release order, and every requirement in the spec. This session does not dispatch review subagents unless Bryan explicitly asks for delegation. Fix every valid issue through a new RED/GREEN cycle and repeat the affected gates.

- [ ] **Step 5: Record the manual acceptance boundary honestly**

Report that automated/local verification is complete but real-iPhone Safari/Chrome acceptance is still pending deployment. The required release sequence is:

1. Bryan approves hosted migration and release.
2. Apply and verify migration 0010 first; it is backward-compatible while a game is live.
3. Push/merge application commits and verify the exact production commit.
4. Run the eight real-iPhone checks in spec §11, including the supplied HEIC, camera, library, replacement, removal, EXIF/GPS, and offline escape.

Do not apply, push, merge, or deploy inside this task.
