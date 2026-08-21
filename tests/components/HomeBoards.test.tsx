import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Home from '../../src/app/page';

/**
 * The signed-in half of `/` is unreachable headlessly — sign-in is Google OAuth, so curl only
 * ever sees the signed-out branch. These tests stand in for that: they drive the page function
 * directly with a stubbed server client and assert the three tabs, the two carried directives
 * (boards have different member sets; a query error must not read as "nobody has played"), and
 * that the Form tab issues no query at all (form_board does not exist yet).
 */
const db = vi.hoisted(() => ({
  user: null as { id: string } | null,
  result: { data: null as Record<string, unknown>[] | null, error: null as { message: string } | null },
  // `ascending` and `count` are recorded alongside the table and order column, not dropped: a
  // recorder that ignores them would stay green with the board ranked worst-player-first, or
  // truncated at a different depth. The direction is the product.
  queries: [] as { table: string; orderBy: string; ascending: boolean | undefined; count: number }[],
}));

vi.mock('../../src/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
  }),
}));

vi.mock('../../src/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        order: (orderBy: string, opts?: { ascending?: boolean }) => ({
          limit: async (count: number) => {
            db.queries.push({ table, orderBy, ascending: opts?.ascending, count });
            return db.result;
          },
        }),
      }),
    }),
  }),
}));

const renderHome = async (board?: string) =>
  render(await Home({ searchParams: Promise.resolve(board ? { board } : {}) }));

afterEach(cleanup);
beforeEach(() => {
  db.user = { id: 'u1' };
  db.result = { data: [], error: null };
  db.queries = [];
});

describe('boards home', () => {
  it('signed out: shows the public leaderboard and keeps play behind sign-in', async () => {
    db.user = null;
    db.result = {
      data: [{ id: 'p1', display_name: 'Ah Seng', total_points: 32, games_played: 3 }],
      error: null,
    };
    await renderHome();
    expect(screen.getByText('Sign in to join a table. To play, tap your seat at the table.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Lifetime' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Skill' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View the standard chip set' })).toBeTruthy();
    expect(screen.getByText('Ah Seng')).toBeTruthy();
    expect(db.queries).toEqual([
      { table: 'lifetime_board', orderBy: 'total_points', ascending: false, count: 50 },
    ]);
  });

  it('lifetime is the default and reads lifetime_board by total_points', async () => {
    await renderHome('bogus');
    // ascending:false is load-bearing — flipped, the board would rank the worst player first.
    expect(db.queries).toEqual([
      { table: 'lifetime_board', orderBy: 'total_points', ascending: false, count: 50 },
    ]);
  });

  it('marks the selected board and keeps signed score semantics', async () => {
    db.result = {
      data: [
        { id: 'p1', display_name: 'Ah Seng', total_points: 32, games_played: 3 },
        { id: 'p2', display_name: 'Bryan', total_points: -32, games_played: 3 },
      ],
      error: null,
    };
    await renderHome('lifetime');
    expect(screen.getByRole('link', { name: 'Lifetime' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('+32')).toBeDefined();
    expect(screen.getByText('-32')).toBeDefined();
    expect(screen.getAllByText('3 games')).toHaveLength(2);
  });

  // Carried directive 1: the boards inner-join, so their member sets differ. A player with
  // notable claims but no ended game is on skill only, and must render there without help
  // from lifetime_board.
  it('signed-out skill renders a player absent from the lifetime board', async () => {
    db.user = null;
    db.result = {
      data: [{ id: 'p9', display_name: 'Ah Huat', notable_wins: 2, total_tai: 0 }],
      error: null,
    };
    await renderHome('skill');
    expect(db.queries).toEqual([
      { table: 'skill_board', orderBy: 'notable_wins', ascending: false, count: 50 },
    ]);
    expect(screen.getByText('Ah Huat')).toBeTruthy();
    // total_tai is 0 until app mode lands, so the tai suffix stays off.
    expect(screen.getByText('2 notable')).toBeTruthy();
  });

  it('offers the hand gallery from the Skill board', async () => {
    await renderHome('skill');

    const gallery = screen.getByRole('link', { name: 'View hand gallery' });
    expect(gallery.getAttribute('href')).toBe('/hands');
  });

  it('does not offer the hand gallery as a top-level action', async () => {
    await renderHome('lifetime');

    const handLinks = screen.queryAllByRole('link')
      .filter((link) => link.getAttribute('href') === '/hands');
    expect(handLinks).toHaveLength(0);
  });

  it('empty boards say something true for the board being shown', async () => {
    await renderHome();
    expect(screen.getByText('No finished games yet.')).toBeTruthy();
    cleanup();
    await renderHome('skill');
    expect(screen.getByText('No notable hands claimed yet.')).toBeTruthy();
  });

  // Carried directive 3: a failed read must not render as an empty board.
  it('a query error reads as a failure, not as an empty board', async () => {
    db.result = { data: null, error: { message: 'permission denied for table players' } };
    await renderHome();
    expect(screen.getByText(/Couldn’t load the Lifetime board/)).toBeTruthy();
    expect(screen.queryByText('No finished games yet.')).toBeNull();
  });

  it('keeps an unavailable Form board honest and read-only', async () => {
    db.user = null;
    await renderHome('form');
    expect(db.queries).toEqual([]);
    expect(screen.getByText(/Form uses per-hand games/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /scorekeeper/i })).toBeNull();
  });
});
