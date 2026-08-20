import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';
import { MAX_UPLOAD_BYTES } from '../src/lib/image';

/**
 * Four separate systems have an opinion about how big a notable-hand photo may be, and a photo
 * that passes three of them and fails the fourth is the worst outcome: the player gets whatever
 * error the layer that refused happens to produce, which for the framework layer is an HTTP 413
 * with no route back into our own "Log it without the photo" escape. So they are pinned
 * together here rather than trusted to stay in step by hand.
 */
const migration = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/0005_notable_photos.sql', import.meta.url)),
  'utf8',
);

describe('the photo size limit means the same thing everywhere', () => {
  it('gives the server action a body limit above the photo limit, not below it', () => {
    // Next's default is 1 MB — BELOW MAX_UPLOAD_BYTES — so leaving this unset let the framework
    // refuse a photo our own code had already accepted, before the action ran at all.
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;
    expect(typeof limit).toBe('number');
    // Strictly greater: the limit counts the multipart envelope along with the photo, so an
    // equal limit would still refuse a photo of exactly the permitted size.
    expect(limit as number).toBeGreaterThan(MAX_UPLOAD_BYTES);
  });

  it('gives the storage bucket the photo limit exactly', () => {
    const declared = /'notable-photos',\s*false,\s*(\d+)/.exec(migration);
    expect(declared).not.toBeNull();
    expect(Number(declared![1])).toBe(MAX_UPLOAD_BYTES);
  });
});
