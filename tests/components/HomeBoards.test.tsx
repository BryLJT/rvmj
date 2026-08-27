import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Home from '../../src/app/page';
import { HousePromptProvider } from '../../src/components/HousePromptProvider';

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
  house: { data: null as { house: string | null } | null, error: null as { message: string } | null },
  // `ascending` and `count` are recorded alongside the table and order column, not dropped: a
  // recorder that ignores them would stay green with the board ranked worst-player-first, or
  // truncated at a different depth. The direction is the product.
  queries: [] as { table: string; orderBy: string; ascending: boolean | undefined; count: number }[],
  profileReads: [] as string[],
}));

vi.mock('../../src/lib/actions/house', () => ({ chooseHouse: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock('../../src/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
  }),
}));

// Two shapes now share one client: the board read ends at .limit(), the profile read ends at
// .maybeSingle(). Each is recorded separately so a test can assert that one happened and the
// other did not.
vi.mock('../../src/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      let orderBy = '';
      let ascending: boolean | undefined;
      query.select = () => query;
      query.eq = () => query;
      query.order = (column: string, opts?: { ascending?: boolean }) => {
        orderBy = column;
        ascending = opts?.ascending;
        return query;
      };
      query.limit = async (count: number) => {
        db.queries.push({ table, orderBy, ascending, count });
        return db.result;
      };
      query.maybeSingle = async () => {
        db.profileReads.push(table);
        return db.house;
      };
      return query;
    },
  }),
}));

const renderHome = async (board?: string) => render(
  <HousePromptProvider>
    {await Home({ searchParams: Promise.resolve(board ? { board } : {}) })}
  </HousePromptProvider>,
);

afterEach(cleanup);
beforeEach(() => {
  db.user = { id: 'u1' };
  db.result = { data: [], error: null };
  db.house = { data: { house: null }, error: null };
  db.queries = [];
  db.profileReads = [];
});

describe('boards home', () => {
  /**
   * The other half of the mid-match Back fix. Three in-match buttons now carry their game so
   * the rules page can return a player to it; this one must keep carrying nothing, or a reader
   * who opened the rules from the leaderboard would be sent into somebody's game on the way out.
   * Asserted here rather than trusted, because the in-match change is the kind that gets applied
   * to "all the House rules links" by the next person to touch them.
   */
  it('leaves the leaderboard house rules link carrying no game', async () => {
    await renderHome();
    expect(screen.getByRole('link', { name: 'House rules' }).getAttribute('href')).toBe('/chips');
  });

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
    expect(screen.getByRole('link', { name: 'House rules' })).toBeTruthy();
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
  it('offers the house action to a signed-in player who has not chosen', async () => {
    await renderHome();

    expect(screen.getByRole('button', { name: 'Choose your house' })).toBeTruthy();
    expect(db.profileReads).toEqual(['players']);
  });

  it('hides the house action once a house is set', async () => {
    db.house = { data: { house: 'rusa' }, error: null };
    await renderHome();

    expect(screen.queryByRole('button', { name: 'Choose your house' })).toBeNull();
  });

  it('never offers the house action to a signed-out visitor, and reads no profile', async () => {
    db.user = null;
    await renderHome();

    expect(screen.queryByRole('button', { name: 'Choose your house' })).toBeNull();
    expect(db.profileReads).toEqual([]);
  });

  // A failed read is not evidence that the player has no house, so the action stays hidden and
  // the board still renders. The next successful read offers the route back in.
  it('hides the action when the profile read fails, without breaking the page', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.house = { data: null, error: { message: 'permission denied for table players' } };
    await renderHome();

    expect(screen.queryByRole('button', { name: 'Choose your house' })).toBeNull();
    expect(screen.getByText('No finished games yet.')).toBeTruthy();
    consoleError.mockRestore();
  });

  it('paints a house row and leaves a house-less one neutral', async () => {
    db.result = {
      data: [
        { id: 'p1', display_name: 'Ah Seng', total_points: 32, games_played: 3, house: 'rusa' },
        { id: 'p2', display_name: 'Bryan', total_points: -32, games_played: 3, house: null },
      ],
      error: null,
    };
    await renderHome('lifetime');

    const [first, second] = screen.getAllByRole('listitem');
    expect(first.style.backgroundColor).toBe('rgb(47, 100, 79)');
    expect(first.style.color).toBe('rgb(255, 253, 248)');
    expect(screen.getByText('Rusa')).toBeTruthy();
    expect(second.style.backgroundColor).toBe('');
    expect(screen.getByText('No house yet')).toBeTruthy();
    // Signed scores still read correctly on both kinds of row.
    expect(screen.getByText('+32')).toBeTruthy();
    expect(screen.getByText('-32')).toBeTruthy();
  });

  it('paints Skill rows from the same catalogue', async () => {
    db.result = {
      data: [{ id: 'p9', display_name: 'Ah Huat', notable_wins: 2, total_tai: 0, house: 'panthera' }],
      error: null,
    };
    await renderHome('skill');

    expect(screen.getByRole('listitem').style.backgroundColor).toBe('rgb(232, 135, 58)');
    expect(screen.getByText('Panthera')).toBeTruthy();
    expect(screen.getByText('2 notable')).toBeTruthy();
  });

  it('ignores a house value the catalogue does not recognise', async () => {
    db.result = {
      data: [{ id: 'p1', display_name: 'Ah Seng', total_points: 1, games_played: 1, house: 'gryffindor' }],
      error: null,
    };
    await renderHome('lifetime');

    expect(screen.getByRole('listitem').style.backgroundColor).toBe('');
    expect(screen.getByText('No house yet')).toBeTruthy();
  });

  it('still issues no query for Form and still offers no scorekeeper', async () => {
    db.house = { data: { house: 'rusa' }, error: null };
    await renderHome('form');

    expect(db.queries).toEqual([]);
    expect(screen.getByText(/Form uses per-hand games/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /scorekeeper/i })).toBeNull();
  });
});
