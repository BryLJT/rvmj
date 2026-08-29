import { describe, it, expect } from 'vitest';
import { isClaimId, one, parseClaimHandTypes } from '../src/lib/notable-claim';

const label = (over: Record<string, unknown> = {}) => ({
  notable_hands: { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare', ...over },
});

describe('one', () => {
  it('reads an embed that arrived as an object', () => {
    expect(one({ name: 'x' })).toEqual({ name: 'x' });
  });

  it('reads an embed that arrived as a one-element array', () => {
    expect(one([{ name: 'x' }])).toEqual({ name: 'x' });
  });

  it('answers null for an absent or empty embed', () => {
    expect(one(null)).toBeNull();
    expect(one(undefined)).toBeNull();
    expect(one([])).toBeNull();
  });
});

describe('isClaimId', () => {
  it('accepts a UUID', () => {
    expect(isClaimId('3f1a5e0c-0d7b-4a2e-9f1b-7c2d8e4a6b90')).toBe(true);
  });

  /**
   * Claim ids arrive from the address bar. Postgres answers a malformed uuid with an ERROR
   * rather than with no rows, so an unchecked value turns a typo into a failed page instead of
   * a not-found one.
   */
  it('refuses anything that is not a UUID', () => {
    expect(isClaimId('nope')).toBe(false);
    expect(isClaimId('3f1a5e0c-0d7b-4a2e-9f1b')).toBe(false);
    expect(isClaimId('')).toBe(false);
    expect(isClaimId(null)).toBe(false);
    expect(isClaimId(42)).toBe(false);
  });
});

describe('parseClaimHandTypes', () => {
  it('reads every label, whichever shape the embed arrived in', () => {
    const parsed = parseClaimHandTypes([
      label(),
      { notable_hands: [{ id: 'h7', name: 'All Pungs', local_name: '碰碰胡', rarity: 'uncommon' }] },
    ]);
    expect(parsed).toEqual([
      { id: 'h7', name: 'All Pungs', local_name: '碰碰胡', rarity: 'uncommon' },
      { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare' },
    ]);
  });

  it('orders by name then id, matching the board', () => {
    const parsed = parseClaimHandTypes([
      label({ id: 'h2', name: 'Zi Mo', local_name: '自摸' }),
      label({ id: 'h1', name: 'Ping Hu', local_name: '平胡' }),
    ]);
    expect(parsed?.map((hand) => hand.name)).toEqual(['Ping Hu', 'Zi Mo']);
  });

  it('keeps a missing local name as null', () => {
    expect(parseClaimHandTypes([label({ local_name: null })])?.[0].local_name).toBeNull();
  });

  /**
   * null means "these labels cannot be read", never "this win has fewer labels than it does".
   * A win rendered a label short understates what somebody actually did at the table.
   */
  it('refuses a label whose fields are wrong rather than dropping it', () => {
    expect(parseClaimHandTypes([label(), { notable_hands: { id: 'h9', name: 'Broken' } }])).toBeNull();
    expect(parseClaimHandTypes([label({ rarity: 'mythic' })])).toBeNull();
    expect(parseClaimHandTypes([label({ name: 7 })])).toBeNull();
    expect(parseClaimHandTypes([label({ local_name: 7 })])).toBeNull();
    expect(parseClaimHandTypes([{ notable_hands: null }])).toBeNull();
  });

  /** The database groups labels per claim and cannot produce a win with none. */
  it('refuses an empty or non-array value', () => {
    expect(parseClaimHandTypes([])).toBeNull();
    expect(parseClaimHandTypes(null)).toBeNull();
    expect(parseClaimHandTypes('two labels')).toBeNull();
  });
});
