import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Link from 'next/link';
import { academicYearLabel, academicYearOf } from '../../src/lib/academic-year';
import Home from '../../src/app/page';
import { HousePromptProvider } from '../../src/components/HousePromptProvider';

/**
 * The signed-in half of `/` is unreachable headlessly — sign-in is Google OAuth, so curl only
 * ever sees the signed-out branch. These tests stand in for that: they drive the page function
 * directly with a stubbed server client and assert the three tabs, shared URL state, query
 * routing, and the carried directive that a query error must not read as "nobody has played".
 */
const db = vi.hoisted(() => ({
  user: null as { id: string } | null,
  result: { data: null as Record<string, unknown>[] | null, error: null as { message: string } | null },
  rpcResult: { data: null as Record<string, unknown>[] | null, error: null as { message: string } | null },
  house: { data: null as { house: string | null } | null, error: null as { message: string } | null },
  // `ascending` and `count` are recorded alongside the table and order column, not dropped: a
  // recorder that ignores them would stay green with the board ranked worst-player-first, or
  // truncated at a different depth. The direction is the product.
  queries: [] as { table: string; orderBy: string; ascending: boolean | undefined; count: number }[],
  tableReads: [] as { table: string; columns: string }[],
  rpcCalls: [] as { name: string; args: Record<string, unknown>; limit?: number }[],
  profileReads: [] as string[],
  years: [] as number[],
  yearsError: null as { message: string } | null,
  notableHands: [] as { id: string; name: string; local_name: string | null; rarity: string }[],
  notableHandsError: null as { message: string } | null,
}));

vi.mock('../../src/lib/actions/house', () => ({ chooseHouse: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock('../../src/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
  }),
}));

// Four shapes now share one client: a board view read ends at .limit(), the profile read ends at
// .maybeSingle(), the two catalogue reads are awaited straight off .select(), and Pts per game is
// a database function call rather than a table read at all. Each is recorded separately so a test
// can assert that one happened and another did not — that is how the boards stay apart.
vi.mock('../../src/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    // A database function call is a builder, not a bare promise: one of the two boards caps its
    // depth with .limit() and the other does not, so the recorder has to be able to tell them
    // apart. The cap is recorded ON the call for the same reason `db.queries` records `count` --
    // a recorder that dropped it would stay green with the cap silently removed.
    rpc: (name: string, args: Record<string, unknown>) => {
      const call: { name: string; args: Record<string, unknown>; limit?: number } = { name, args };
      db.rpcCalls.push(call);
      const builder = {
        limit: (count: number) => { call.limit = count; return builder; },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(db.rpcResult).then(res, rej),
      };
      return builder;
    },
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      let orderBy = '';
      let ascending: boolean | undefined;
      // academic_years is awaited straight off .select(), with no .limit() to end the chain,
      // so that shape needs its own thenable rather than the shared query object.
      query.select = (columns = '*') => {
        db.tableReads.push({ table, columns });
        if (table === 'academic_years') {
          return {
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(
                db.yearsError
                  ? { data: null, error: db.yearsError }
                  : { data: db.years.map((y) => ({ academic_year: y })), error: null },
              ).then(res, rej),
          };
        }
        if (table === 'notable_hands') {
          return {
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(
                db.notableHandsError
                  ? { data: null, error: db.notableHandsError }
                  : { data: db.notableHands, error: null },
              ).then(res, rej),
          };
        }
        return query;
      };
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

const thisYear = academicYearOf(new Date());

/**
 * The twelve seeded hand types, in migration 0001's insertion order. The IDs deliberately do not
 * sort like the names, so nothing here can pass by accident on an implementation that confused
 * the two orders.
 */
const CATALOGUE = [
  { id: 'h1', name: 'Thirteen Wonders', local_name: '十三幺', rarity: 'legendary' },
  { id: 'h2', name: 'Heavenly Hand', local_name: '天糊', rarity: 'legendary' },
  { id: 'h3', name: 'Earthly Hand', local_name: '地糊', rarity: 'legendary' },
  { id: 'h4', name: 'Great Winds', local_name: '大四喜', rarity: 'legendary' },
  { id: 'h5', name: 'Big Three Dragons', local_name: '大三元', rarity: 'rare' },
  { id: 'h6', name: 'Small Three Dragons', local_name: '小三元', rarity: 'rare' },
  { id: 'h7', name: 'All Pungs', local_name: '碰碰胡', rarity: 'uncommon' },
  { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare' },
  { id: 'h9', name: 'Mixed Suit', local_name: '混一色', rarity: 'uncommon' },
  { id: 'h10', name: 'Kong on Kong', local_name: '杠上开花', rarity: 'rare' },
  { id: 'h11', name: 'Robbing the Kong', local_name: '抢杠', rarity: 'rare' },
  { id: 'h12', name: 'Last Tile Catch', local_name: '海底捞月', rarity: 'rare' },
];

const label = (id: string) => CATALOGUE.find((hand) => hand.id === id)!;

/** One row exactly as `notable_wins_board` returns it: one physical win, however many labels. */
const win = (claimId: string, winner: string, wonAt: string, handIds: string[]) => ({
  claim_id: claimId,
  player_id: `p-${claimId}`,
  display_name: winner,
  house: null,
  created_at: wonAt,
  hand_types: handIds.map(label),
  total_label_count: handIds.length,
  selected_match_count: 0,
});

const renderHome = async (
  board?: string | string[],
  year?: string | string[],
  hand?: string | string[],
) => render(
  <HousePromptProvider>
    {await Home({ searchParams: Promise.resolve({
      ...(board ? { board } : {}),
      ...(year ? { year } : {}),
      ...(hand ? { hand } : {}),
    }) })}
  </HousePromptProvider>,
);

afterEach(cleanup);
beforeEach(() => {
  db.user = { id: 'u1' };
  db.result = { data: [], error: null };
  db.rpcResult = { data: [], error: null };
  db.house = { data: { house: null }, error: null };
  db.queries = [];
  db.tableReads = [];
  db.rpcCalls = [];
  db.profileReads = [];
  db.years = [];
  db.yearsError = null;
  db.notableHands = [];
  db.notableHandsError = null;
});

/**
 * `prefetch` never reaches the HTML -- it is an instruction to Next's router, not an attribute
 * the browser sees. So this walks the element tree the page function actually returns, rather
 * than asserting on markup that could never carry it, or on a stand-in Link that would only
 * prove the stand-in works.
 */
function findLinks(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) { node.forEach((n) => findLinks(n, found)); return found; }
  if (!node || typeof node !== 'object') return found;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!el.props) return found;
  if (el.type === Link) found.push(el.props);
  findLinks(el.props.children, found);
  return found;
}

describe('boards home', () => {
  // It leads to a page about your own account, so offering it signed out leads only to a wall.
  it('offers account settings to a signed-in player', async () => {
    db.user = { id: 'u1' };
    await renderHome();
    expect(screen.getByRole('link', { name: 'Account settings' })).toBeDefined();
  });

  it('does not offer account settings to a signed-out visitor', async () => {
    db.user = null;
    await renderHome();
    expect(screen.queryByRole('link', { name: 'Account settings' })).toBeNull();
  });

  /**
   * Spec §4.1. The default is the CURRENT academic year, EXCEPT while that year is still empty.
   * Without the fallback, RVMJ greets everyone with "No finished games yet" on the first morning
   * of every new academic year: a board that looks like it has lost its whole history, on the
   * night the group most wants to play.
   *
   * The current year is whatever academicYearOf says it is today, so these tests derive it
   * rather than hard-coding 2026, which would start failing in August 2027.
   */
  it('opens on the current academic year once it has games', async () => {
    db.years = [thisYear];
    await renderHome();
    expect(screen.getByRole('link', { name: academicYearLabel(thisYear) }).getAttribute('aria-current')).toBe('page');
  });

  it('falls back to all time while the current year is still empty', async () => {
    db.years = [thisYear - 1];
    await renderHome();
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('aria-current')).toBe('page');
  });

  it('honours an explicit all-time request', async () => {
    db.years = [thisYear];
    await renderHome(undefined, 'all');
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('aria-current')).toBe('page');
  });

  it('treats a malformed year as absent rather than erroring', async () => {
    db.years = [thisYear];
    await renderHome(undefined, 'not-a-year');
    expect(screen.getByRole('link', { name: academicYearLabel(thisYear) }).getAttribute('aria-current')).toBe('page');
  });

  it('ignores a well-formed year that has no games', async () => {
    db.years = [thisYear];
    await renderHome(undefined, '2021');
    expect(screen.getByRole('link', { name: academicYearLabel(thisYear) }).getAttribute('aria-current')).toBe('page');
  });

  it('reads the per-year board for a year and the all-time board for all time', async () => {
    db.years = [thisYear];
    await renderHome(undefined, 'all');
    expect(db.queries.map((q) => q.table)).toContain('lifetime_board');

    db.queries = [];
    await renderHome(undefined, String(thisYear));
    expect(db.queries.map((q) => q.table)).toContain('lifetime_board_by_year');
  });

  // A failed read of the year list must not read as "no years exist".
  it('still renders the board when the year list cannot be read', async () => {
    db.yearsError = { message: 'boom' };
    await renderHome();
    expect(screen.queryByRole('navigation', { name: 'Academic year' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Leaderboard' })).toBeDefined();
  });

  /**
   * One period selector now governs all three boards, so the row must appear under every tab.
   * Previously it belonged to the points board alone; a board that quietly dropped the row would
   * strand a player on a year they could no longer see or change.
   */
  it('shows the same year row on every board', async () => {
    db.years = [thisYear];
    for (const board of ['lifetime', 'form', 'skill']) {
      cleanup();
      await renderHome(board);
      expect(screen.getByRole('navigation', { name: 'Academic year' })).toBeDefined();
      expect(screen.getByRole('link', { name: academicYearLabel(thisYear) }).getAttribute('aria-current')).toBe('page');
    }
  });

  /**
   * Measured before this was added, on a local production build with no network latency at all:
   * a board tab switch took a median 65ms and ranged 23-161ms. With the full route prefetched it
   * was a median 15ms, ranging 14-27ms. The collapsed RANGE is the point -- a control that is
   * usually quick and occasionally slow reads as broken, and a phone adds mobile latency to every
   * one of those numbers but not to a payload already sitting in the browser.
   *
   * Next only prefetches a dynamic route's contents when told to. This page reads cookies to know
   * who is signed in, so it is classified dynamic and the default fetches an empty frame.
   */
  it('prefetches the other board tabs so a switch does not wait on the server', async () => {
    const boardLinks = findLinks(await Home({ searchParams: Promise.resolve({}) }))
      .filter((props) => String(props.href).startsWith('/?board='));

    expect(boardLinks.map((p) => p.href))
      .toEqual(['/?board=lifetime&year=all', '/?board=form&year=all', '/?board=skill&year=all']);
    for (const props of boardLinks) expect(props.prefetch).toBe(true);
  });

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
    expect(screen.getByRole('link', { name: 'Total score' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Notable wins' })).toBeTruthy();
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
    expect(screen.getByRole('link', { name: 'Total score' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('+32')).toBeDefined();
    expect(screen.getByText('-32')).toBeDefined();
    expect(screen.getAllByText('3 games')).toHaveLength(2);
  });

  /**
   * Carried directive 1 in its new form. Notable wins is no longer a player aggregate joined to
   * the ended-game history, so it reads NO board view at all: a signed-out visitor sees the same
   * ranked wins the ranking function returns, whether or not those winners appear on Total score.
   */
  it('signed-out Notable wins renders the ranking function, reading no board view', async () => {
    db.user = null;
    db.rpcResult = { data: [win('c1', 'Ah Huat', '2026-08-27T17:30:00Z', ['h7', 'h8'])], error: null };
    await renderHome('skill');

    expect(db.queries).toEqual([]);
    expect(screen.getByText('Ah Huat')).toBeTruthy();
    expect(screen.getByText('All Pungs')).toBeTruthy();
    expect(screen.getByText('Pure Suit')).toBeTruthy();
  });

  it('offers the hand gallery from the Skill board', async () => {
    await renderHome('skill');

    const gallery = screen.getByRole('link', { name: 'View hand gallery' });
    expect(gallery.getAttribute('href')).toBe('/hands?year=all');
  });

  it('does not offer the hand gallery as a top-level action', async () => {
    await renderHome('lifetime');

    const handLinks = screen.queryAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/hands'));
    expect(handLinks).toHaveLength(0);
  });

  it('empty boards say something true for the board being shown', async () => {
    await renderHome();
    expect(screen.getByText('No finished games yet.')).toBeTruthy();
    cleanup();
    // Pts per game is averaged from the same finished games, so it says the same thing.
    await renderHome('form');
    expect(screen.getByText('No finished games yet.')).toBeTruthy();
    cleanup();
    // Notable wins ranks individual WINS, so an empty board is about wins, not about players.
    await renderHome('skill');
    expect(screen.getByText('No notable wins yet.')).toBeTruthy();
  });

  /**
   * Carried directive 3: a failed read must not render as an empty board.
   *
   * Spec §15 gives ONE unqualified sentence for a failed board, and Notable wins will reuse it,
   * so Total score no longer names itself. The apostrophe asserted here is the curly U+2019 the
   * rest of the app's copy uses; a straight quote would be a visible typographic regression.
   */
  it('a query error reads as a failure, not as an empty board', async () => {
    db.result = { data: null, error: { message: 'permission denied for table players' } };
    await renderHome();
    expect(screen.getByText('Couldn’t load this board')).toBeTruthy();
    expect(screen.queryByText('No finished games yet.')).toBeNull();
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

  it('ignores a house value the catalogue does not recognise', async () => {
    db.result = {
      data: [{ id: 'p1', display_name: 'Ah Seng', total_points: 1, games_played: 1, house: 'gryffindor' }],
      error: null,
    };
    await renderHome('lifetime');

    expect(screen.getByRole('listitem').style.backgroundColor).toBe('');
    expect(screen.getByText('No house yet')).toBeTruthy();
  });

  it('still reads no board view for Pts per game and still offers no scorekeeper', async () => {
    db.house = { data: { house: 'rusa' }, error: null };
    await renderHome('form');

    // The average comes from a database function, so no view is read for this board at all.
    expect(db.queries).toEqual([]);
    expect(screen.queryByRole('button', { name: /scorekeeper/i })).toBeNull();
  });

  /**
   * The three tabs keep their route keys — `lifetime`, `form`, `skill` — so every bookmark and
   * shared link written before this release still opens the board it named. Only what a player
   * READS changed. Both halves are asserted together because renaming a tab by renaming its key
   * is exactly the shortcut that would break those links.
   */
  it('shows the exact tab labels without renaming the routes behind them', async () => {
    await renderHome();

    expect(screen.getByRole('link', { name: 'Total score' }).getAttribute('href')).toBe('/?board=lifetime&year=all');
    expect(screen.getByRole('link', { name: 'Pts per game' }).getAttribute('href')).toBe('/?board=form&year=all');
    expect(screen.getByRole('link', { name: 'Notable wins' }).getAttribute('href')).toBe('/?board=skill&year=all');
    for (const gone of ['Lifetime', 'Form', 'Skill']) {
      expect(screen.queryByRole('link', { name: gone })).toBeNull();
    }
  });

  /**
   * A player filters Notable wins by hand type, glances at Total score, and comes back. The two
   * point boards ignore the filter values, but they must still carry them, or the trip back
   * silently clears the selection. Unknown IDs are dropped against the real catalogue so a
   * hand-typed address cannot park junk in every link on the page.
   */
  it('carries the chosen year and valid hand filters through every tab and pill', async () => {
    db.years = [thisYear];
    db.notableHands = CATALOGUE;
    await renderHome('form', String(thisYear), ['h2', 'not-a-hand', 'h1']);

    const carried = `year=${thisYear}&hand=h1&hand=h2`;
    expect(screen.getByRole('link', { name: 'Total score' }).getAttribute('href')).toBe(`/?board=lifetime&${carried}`);
    expect(screen.getByRole('link', { name: 'Pts per game' }).getAttribute('href')).toBe(`/?board=form&${carried}`);
    expect(screen.getByRole('link', { name: 'Notable wins' }).getAttribute('href')).toBe(`/?board=skill&${carried}`);
    // Changing the year keeps the board and the filters; it only moves the period.
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('href'))
      .toBe('/?board=form&year=all&hand=h1&hand=h2');
  });

  /**
   * The catalogue is read on every board for the check above, not only on the board that uses it.
   *
   * The columns are pinned because the filter panel renders the catalogue itself: it groups by
   * `rarity` and shows `local_name` beside each English name, so a read narrowed back to
   * `id, name` would still validate URL filters correctly while quietly emptying the panel.
   */
  it('reads the hand catalogue on every board', async () => {
    for (const board of ['lifetime', 'form', 'skill']) {
      cleanup();
      db.tableReads = [];
      await renderHome(board);
      expect(db.tableReads.filter((read) => read.table === 'notable_hands'))
        .toEqual([{ table: 'notable_hands', columns: 'id, name, local_name, rarity' }]);
    }
  });

  // Same fail-soft posture as the year list: an unreadable catalogue costs the filters, not the page.
  it('drops hand filters rather than the page when the catalogue cannot be read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.notableHandsError = { message: 'boom' };
    await renderHome('skill', 'all', 'h1');

    expect(screen.getByRole('link', { name: 'Notable wins' }).getAttribute('href')).toBe('/?board=skill&year=all');
    expect(screen.getByRole('navigation', { name: 'Leaderboard' })).toBeDefined();
    consoleError.mockRestore();
  });

  /**
   * `hand` is the one parameter meant to repeat. A repeated `year` is malformed, so it falls to
   * the default period rather than one of the two values guessing which the player meant.
   */
  it('falls back to the default year when the year parameter is repeated', async () => {
    db.years = [thisYear, thisYear - 1];
    await renderHome(undefined, [String(thisYear - 1), String(thisYear)]);

    expect(screen.getByRole('link', { name: academicYearLabel(thisYear) }).getAttribute('aria-current')).toBe('page');
  });

  /**
   * The 20-game window and the year boundary both live inside the database function, so the page
   * passes exactly one thing: which period. `null` is All time — it removes the year boundary and
   * nothing else. Asserting the argument is the only way to catch the two swapped.
   */
  it('asks for the whole history on all time and one year on a year', async () => {
    db.years = [thisYear];
    await renderHome('form', 'all');
    expect(db.rpcCalls).toEqual([{ name: 'points_per_game_board', args: { p_academic_year: null }, limit: 50 }]);

    cleanup();
    db.rpcCalls = [];
    await renderHome('form', String(thisYear));
    expect(db.rpcCalls).toEqual([{ name: 'points_per_game_board', args: { p_academic_year: thisYear }, limit: 50 }]);
  });

  // Total score is a view and must never reach for a database function.
  it('calls no database function from Total score', async () => {
    await renderHome('lifetime');
    expect(db.rpcCalls).toEqual([]);
  });

  /**
   * The fixture is deliberately NOT in average order. The database already ranks these rows —
   * highest average first, then more games, then name, then ID — and the page must render that
   * order as given. A page that re-sorted by average would put Ah Seng first and fail here.
   */
  it('renders Pts per game in the order the database returned', async () => {
    db.rpcResult = {
      data: [
        { id: 'p2', display_name: 'Bryan', house: null, avg_points: 0, games_counted: 19 },
        { id: 'p1', display_name: 'Ah Seng', house: null, avg_points: 8.5, games_counted: 20 },
        { id: 'p3', display_name: 'Ah Huat', house: null, avg_points: -3.2, games_counted: 1 },
      ],
      error: null,
    };
    await renderHome('form');

    const names = screen.getAllByRole('listitem').map((row) => row.querySelector('p')?.textContent);
    expect(names).toEqual(['Bryan', 'Ah Seng', 'Ah Huat']);
  });

  /**
   * Spec §7.1. Under twenty the row says how many games it actually averaged, so a two-game
   * average is not mistaken for a settled one. At twenty it says which twenty instead, because
   * the count stops moving there while the games behind it keep changing.
   */
  it('says how many games each average counted, and names the window at twenty', async () => {
    db.rpcResult = {
      data: [
        { id: 'p1', display_name: 'Ah Seng', house: null, avg_points: 8.5, games_counted: 20 },
        { id: 'p2', display_name: 'Bryan', house: null, avg_points: 0, games_counted: 19 },
        { id: 'p3', display_name: 'Ah Huat', house: null, avg_points: -3.2, games_counted: 1 },
      ],
      error: null,
    };
    await renderHome('form');

    expect(screen.getByText('Latest 20 games')).toBeTruthy();
    expect(screen.getByText('19 games counted')).toBeTruthy();
    expect(screen.getByText('1 game counted')).toBeTruthy();
  });

  /**
   * Spec §7.1. One decimal, sign kept, zero neutral. The colour is asserted with the number
   * because they are computed from the same formatted string on purpose: a raw -0.04 that reads
   * as `0.0` must not also be painted as a loss.
   */
  it('shows signed one-decimal averages painted to match what they say', async () => {
    db.rpcResult = {
      data: [
        { id: 'p1', display_name: 'Ah Seng', house: null, avg_points: 8.54, games_counted: 4 },
        { id: 'p2', display_name: 'Bryan', house: null, avg_points: -0.04, games_counted: 4 },
        { id: 'p3', display_name: 'Ah Huat', house: null, avg_points: -3.2, games_counted: 4 },
      ],
      error: null,
    };
    await renderHome('form');

    expect(screen.getByText('+8.5').className).toContain('text-gain');
    expect(screen.getByText('0.0').className).toContain('text-muted');
    expect(screen.getByText('-3.2').className).toContain('text-coral');
  });

  // The board failed; it did not find that nobody has played.
  it('a failed Pts per game read reads as a failure, not as an empty board', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpcResult = { data: null, error: { message: 'permission denied for function' } };
    await renderHome('form');

    expect(screen.getByText('Couldn’t load this board')).toBeTruthy();
    expect(screen.queryByText('No finished games yet.')).toBeNull();
    consoleError.mockRestore();
  });

  /**
   * Bryan's explicit directive: the interface never explains app mode. The old Form tab was a
   * placeholder that did exactly that ("Chip mode is the only live mode right now"), and it is
   * gone along with the board it excused. Checked on every tab, because the sentence only had to
   * survive on one of them to reach a player.
   */
  it('explains nothing about app mode on any board', async () => {
    for (const board of ['lifetime', 'form', 'skill']) {
      cleanup();
      const { container } = await renderHome(board);
      expect(container.textContent).not.toMatch(/app mode/i);
      expect(container.textContent).not.toMatch(/chip mode/i);
      expect(container.textContent).not.toMatch(/per-hand games/i);
    }
  });
});

/**
 * Notable wins stopped being a player aggregate. It ranks individual winning hands through one
 * database function, and the URL — board, year, and every checked hand type — is the whole of
 * its state. These cover the seam between the two: what the page sends, and what it does with
 * what comes back.
 */
describe('notable wins ranking', () => {
  it('sends only the valid unique hand IDs, dropping repeats and junk', async () => {
    db.notableHands = CATALOGUE;
    await renderHome('skill', 'all', ['h7', 'not-a-hand', 'h7', 'h1', '../../etc/passwd']);

    expect(db.rpcCalls).toEqual([
      { name: 'notable_wins_board', args: { p_academic_year: null, p_hand_ids: ['h1', 'h7'] }, limit: 50 },
    ]);
  });

  // No selection means every notable win, not an error and not a board that refuses to load.
  it('sends an empty filter set when nothing is selected', async () => {
    db.notableHands = CATALOGUE;
    await renderHome('skill', 'all');

    expect(db.rpcCalls).toEqual([
      { name: 'notable_wins_board', args: { p_academic_year: null, p_hand_ids: [] }, limit: 50 },
    ]);
  });

  /**
   * The year pills sit on this board too, so the period has to reach the RANKING and not only
   * the pill that claims to be selected. A board that highlighted a year it did not apply would
   * be worse than one with no year row at all.
   */
  it('applies the selected academic year to the ranking, not just to the pills', async () => {
    db.years = [thisYear];
    db.notableHands = CATALOGUE;
    await renderHome('skill', String(thisYear));

    expect(db.rpcCalls).toEqual([
      { name: 'notable_wins_board', args: { p_academic_year: thisYear, p_hand_ids: [] }, limit: 50 },
    ]);
  });

  /**
   * The retired `skill_board` read was capped at 50 rows and both neighbouring boards still are.
   * This board ranks individual WINS rather than players, so its row count grows with every
   * notable hand ever logged rather than with the number of people playing — and all three tabs
   * are prefetched on every home view, so an uncapped board is downloaded even by someone who
   * never opens it. Dropping the cap in the move to a function would have been a regression
   * nothing else would catch.
   */
  /**
   * All three boards, asserted together. Each is capped at the same depth, and all three tabs are
   * prefetched on every home view — so a board that quietly lost its cap would be downloaded in
   * full by every visitor, including the ones who never open that tab.
   */
  it('caps every board at the same depth', async () => {
    db.notableHands = CATALOGUE;
    await renderHome('lifetime');
    expect(db.queries.map((query) => query.count)).toEqual([50]);

    cleanup();
    db.rpcCalls = [];
    await renderHome('form');
    expect(db.rpcCalls.map((call) => call.limit)).toEqual([50]);

    cleanup();
    db.rpcCalls = [];
    await renderHome('skill');
    expect(db.rpcCalls.map((call) => call.limit)).toEqual([50]);
  });

  it('caps the ranking at the same depth as the boards either side of it', async () => {
    db.notableHands = CATALOGUE;
    await renderHome('skill');

    expect(db.rpcCalls.map((call) => call.limit)).toEqual([50]);
  });

  /**
   * The fixture is deliberately in no order any local rule would produce: not by label count,
   * not by date, not by name. Match-any eligibility and match-count-first ranking live in the
   * database, and the page renders what it is handed.
   */
  it('sends several filters together and renders the order the ranking returned', async () => {
    db.notableHands = CATALOGUE;
    db.rpcResult = {
      data: [
        win('c3', 'Bryan', '2026-08-01T04:00:00Z', ['h7']),
        win('c1', 'Ah Seng', '2026-08-27T17:30:00Z', ['h7', 'h8', 'h1']),
        win('c2', 'Ah Huat', '2026-08-20T04:00:00Z', ['h8', 'h9']),
      ],
      error: null,
    };
    await renderHome('skill', 'all', ['h8', 'h7']);

    expect(db.rpcCalls[0].args.p_hand_ids).toEqual(['h7', 'h8']);
    expect(screen.getAllByRole('listitem').map((row) => row.querySelector('p')?.textContent))
      .toEqual(['Bryan', 'Ah Seng', 'Ah Huat']);
  });

  /**
   * The whole point of the multi-label change: one physical win stays one win. Three labels must
   * not become three ranked rows, which would let one hand crowd out everybody else's.
   */
  it('renders one row per physical win, carrying every label', async () => {
    db.rpcResult = { data: [win('c1', 'Ah Seng', '2026-08-27T17:30:00Z', ['h7', 'h8', 'h1'])], error: null };
    const { container } = await renderHome('skill');

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect([...screen.getByRole('group', { name: 'Hand types' }).children].map((chip) => chip.textContent))
      .toEqual(['All Pungs', 'Pure Suit', 'Thirteen Wonders']);
    expect(screen.getByText('3 labels')).toBeTruthy();
    // 17:30 UTC is 01:30 the next morning in Singapore, and the night belongs to where it was played.
    expect(screen.getByText('28 Aug 2026')).toBeTruthy();
    // The gallery stays the photo archive; the ranking never becomes a second one.
    expect(container.querySelector('img')).toBeNull();
  });

  it('offers the whole catalogue as a filter, with the current selection already checked', async () => {
    db.years = [thisYear];
    db.notableHands = CATALOGUE;
    const { container } = await renderHome('skill', String(thisYear), 'h7');

    const panel = container.querySelector('form') as HTMLFormElement;
    expect(container.querySelectorAll('input[name="hand"]')).toHaveLength(12);
    const submitted = new FormData(panel);
    expect(submitted.get('board')).toBe('skill');
    expect(submitted.get('year')).toBe(String(thisYear));
    expect(submitted.getAll('hand')).toEqual(['h7']);
    expect(screen.getByRole('link', { name: 'Remove All Pungs' }).getAttribute('href'))
      .toBe(`/?board=skill&year=${thisYear}`);
  });

  it('offers the hand-type filter on no other board', async () => {
    for (const board of ['lifetime', 'form']) {
      cleanup();
      db.notableHands = CATALOGUE;
      await renderHome(board);
      expect(screen.queryByText('Filter hand types')).toBeNull();
    }
  });

  it('says a filtered board found nothing, rather than that nothing has been logged', async () => {
    db.notableHands = CATALOGUE;
    await renderHome('skill', 'all', 'h7');

    expect(screen.getByText('No notable wins match these hand types.')).toBeTruthy();
    expect(screen.queryByText('No notable wins yet.')).toBeNull();
  });

  it('says an unfiltered board is empty, rather than blaming filters nobody set', async () => {
    db.notableHands = CATALOGUE;
    await renderHome('skill', 'all');

    expect(screen.getByText('No notable wins yet.')).toBeTruthy();
    expect(screen.queryByText('No notable wins match these hand types.')).toBeNull();
  });

  it('a failed ranking read reads as a failure, not as an empty board', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpcResult = { data: null, error: { message: 'permission denied for function' } };
    await renderHome('skill');

    expect(screen.getByText('Couldn’t load this board')).toBeTruthy();
    expect(screen.queryByText('No notable wins yet.')).toBeNull();
    consoleError.mockRestore();
  });

  /**
   * A win whose labels cannot be read would render a label short — understating what somebody
   * did at the table, and sinking it in a ranking ordered by label count. That is a broken
   * board, so the board says so instead of showing a partial win beside whole ones.
   */
  it('fails the board when a win’s labels cannot be read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.rpcResult = {
      data: [
        win('c1', 'Ah Seng', '2026-08-27T17:30:00Z', ['h7']),
        { ...win('c2', 'Bryan', '2026-08-20T04:00:00Z', ['h8']), hand_types: 'not json' },
      ],
      error: null,
    };
    await renderHome('skill');

    expect(screen.getByText('Couldn’t load this board')).toBeTruthy();
    expect(screen.queryByText('Ah Seng')).toBeNull();
    consoleError.mockRestore();
  });

  /**
   * These parameters are RETURN STATE, not a gallery filter. Spec §11 still holds — the archive
   * shows every photographed win either way, which `tests/pages/hands-page.test.ts` pins — but
   * the gallery's own back arrow can now rebuild the exact standings view the player left instead
   * of dropping them on a bare Notable wins board with their period and filters gone.
   *
   * Asserted with a year and filters actually set, because a link that only carries them when
   * nothing is selected would prove nothing.
   */
  it('carries the current period and filters to the gallery as return state', async () => {
    db.years = [thisYear];
    db.notableHands = CATALOGUE;
    await renderHome('skill', String(thisYear), ['h7', 'h8']);

    expect(screen.getByRole('link', { name: 'View hand gallery' }).getAttribute('href'))
      .toBe(`/hands?year=${thisYear}&hand=h7&hand=h8`);
  });

  /**
   * An unreadable catalogue leaves `knownHandIds` empty, so every URL filter is dropped and the
   * panel has nothing to draw. Rendering that as an ordinary empty selection would tell a player
   * their filters are off when the truth is that the app could not check them — so the board
   * keeps working, unfiltered, and says which part failed.
   */
  it('says the hand types failed rather than presenting an empty filter as no selection', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.notableHandsError = { message: 'boom' };
    db.rpcResult = { data: [win('c1', 'Ah Seng', '2026-08-27T17:30:00Z', ['h7'])], error: null };
    const { container } = await renderHome('skill', 'all', 'h7');

    expect(screen.getByText('Couldn’t load hand types just now. Showing every notable win.')).toBeTruthy();
    expect(screen.queryByText('Filter hand types')).toBeNull();
    expect(container.querySelector('input[name="hand"]')).toBeNull();
    // The ranking itself is unaffected, so the board still shows the wins it could read.
    expect(screen.getByText('Ah Seng')).toBeTruthy();
    consoleError.mockRestore();
  });
});
