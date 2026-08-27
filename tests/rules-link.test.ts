import { describe, expect, it } from 'vitest';
import { rulesBackHref, rulesHref } from '../src/lib/rules-link';

/**
 * The House rules page is reached from four places: the leaderboard and three in-match screens.
 * It is one page, so it has to be TOLD which one, or its Back arrow can only ever guess — and
 * the guess it shipped with sent every reader to the leaderboard, including the three quarters
 * of them who were mid-match.
 *
 * Both directions live here as pure functions so the rule is stated once and asserted directly,
 * rather than being re-derived at four call sites.
 */

const GAME = '11111111-2222-3333-4444-555555555555';

describe('rulesHref — where a House rules button points', () => {
  it('carries the match a player is currently in', () => {
    expect(rulesHref(GAME)).toBe(`/chips?game=${GAME}`);
  });

  it('carries nothing when read outside a match', () => {
    expect(rulesHref()).toBe('/chips');
  });

  it('carries nothing when handed an empty id', () => {
    expect(rulesHref('')).toBe('/chips');
  });

  /**
   * The outbound side builds, it does not judge — the id it is handed came from our own server.
   * What it owes is escaping, so an id can only ever be a value and never smuggle a second
   * parameter in alongside itself.
   */
  it('escapes the id rather than letting it add parameters of its own', () => {
    expect(rulesHref('a b&board=skill')).toBe('/chips?game=a%20b%26board%3Dskill');
  });
});

describe('rulesBackHref — where the rules page returns to', () => {
  it('returns a mid-match reader to their own match', () => {
    expect(rulesBackHref(GAME)).toBe(`/game/${GAME}`);
  });

  it('returns everyone else to the leaderboard', () => {
    expect(rulesBackHref(undefined)).toBe('/');
  });

  /**
   * The load-bearing case. The Back arrow renders whatever this returns, so if the parameter
   * were used as a destination rather than as an ID, a link could be handed to a player that
   * shows RVMJ's own rules page above a Back button leading somewhere else entirely. Only a
   * uuid is ever accepted, and the destination is built here rather than supplied — so the
   * dangerous value is not merely rejected, it never reaches the page.
   */
  it.each([
    ['an absolute address', 'https://example.com'],
    ['a protocol-relative address', '//example.com'],
    ['a path traversal', '../../login'],
    ['a javascript url', 'javascript:alert(1)'],
    ['an empty string', ''],
  ])('refuses %s and returns to the leaderboard', (_label, hostile) => {
    expect(rulesBackHref(hostile)).toBe('/');
  });

  /** Next hands back an array when a parameter is repeated (`?game=a&game=b`). */
  it('reads the first value when the parameter is repeated', () => {
    expect(rulesBackHref([GAME, 'other'])).toBe(`/game/${GAME}`);
  });

  it('returns to the leaderboard when a repeated parameter leads with junk', () => {
    expect(rulesBackHref(['not-a-game', GAME])).toBe('/');
  });
});
