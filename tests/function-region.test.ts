import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * RVMJ's server functions ran in `iad1` (Washington DC) while its database, its Supabase auth
 * and all four of its players are in Singapore. Measured on production before this file existed:
 * `x-vercel-id: sin1::iad1`, and 0.77s / 1.42s / 2.04s for three loads of the signed-out home
 * page. Every page load asks the database several questions, and each one was crossing the
 * Pacific twice.
 *
 * This is a one-line setting whose absence is invisible: nothing fails, nothing logs, the app
 * is simply slow for everyone. Deleting the file or "cleaning up" the region would restore the
 * old behaviour silently, so the region is pinned here rather than trusted to a config nobody
 * re-reads.
 */
const vercelConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'),
);

describe('server functions run beside the database, not across an ocean', () => {
  it('pins the function region to Singapore', () => {
    expect(vercelConfig.regions).toEqual(['sin1']);
  });

  // One region, deliberately. A second region would put some requests back across the Pacific
  // from a database that exists in exactly one place, which is worse than a predictable single
  // hop: the slow loads would then be intermittent and much harder to attribute.
  it('names exactly one region', () => {
    expect(vercelConfig.regions).toHaveLength(1);
  });
});
