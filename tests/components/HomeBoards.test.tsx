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
  queries: [] as { table: string; orderBy: string }[],
}));

vi.mock('../../src/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: string) => ({
      select: () => ({
        order: (orderBy: string) => ({
          limit: async () => {
            db.queries.push({ table, orderBy });
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
  it('signed out: prompts sign-in, shows no tabs, and queries nothing', async () => {
    db.user = null;
    await renderHome();
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.queryByText('Lifetime')).toBeNull();
    expect(db.queries).toEqual([]);
  });

  it('lifetime is the default and reads lifetime_board by total_points', async () => {
    db.result = {
      data: [
        { id: 'p1', display_name: 'Ah Seng', total_points: 32, games_played: 3 },
        { id: 'p2', display_name: 'Bryan', total_points: -32, games_played: 3 },
      ],
      error: null,
    };
    await renderHome('bogus');
    expect(db.queries).toEqual([{ table: 'lifetime_board', orderBy: 'total_points' }]);
    expect(screen.getByText('32 pts · 3 games')).toBeTruthy();
    expect(screen.getByText('-32 pts · 3 games')).toBeTruthy();
  });

  // Carried directive 1: the boards inner-join, so their member sets differ. A player with
  // notable claims but no ended game is on skill only, and must render there without help
  // from lifetime_board.
  it('skill renders a player absent from the lifetime board', async () => {
    db.result = {
      data: [{ id: 'p9', display_name: 'Ah Huat', notable_wins: 2, total_tai: 0 }],
      error: null,
    };
    await renderHome('skill');
    expect(db.queries).toEqual([{ table: 'skill_board', orderBy: 'notable_wins' }]);
    expect(screen.getByText('Ah Huat')).toBeTruthy();
    // total_tai is 0 until app mode lands, so the tai suffix stays off.
    expect(screen.getByText('2 notable')).toBeTruthy();
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

  it('form explains itself without querying — form_board does not exist yet', async () => {
    await renderHome('form');
    expect(db.queries).toEqual([]);
    expect(screen.getByText(/Form ranks app-scorekeeper games/)).toBeTruthy();
  });
});
