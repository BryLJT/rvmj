import Link from 'next/link';
import { BoardRow } from '../components/BoardRow';
import { ChooseHouseAction } from '../components/ChooseHouseAction';
import { HandTypeFilter, type HandType } from '../components/HandTypeFilter';
import { NotableWinRow, parseNotableWins } from '../components/NotableWinRow';
import { YearPills } from '../components/YearPills';
import { MadeByBanner } from '../components/MadeByBanner';
import { SettingsLink } from '../components/SettingsLink';
import { ActionLink, AppFrame, BrandMark, StatusMessage } from '../components/ui';
import { academicYearOf, parseYearParam } from '../lib/academic-year';
import { findHouse } from '../lib/houses';
import {
  BOARDS,
  formatPointsPerGame,
  normalizeBoard,
  normalizeHandFilters,
  standingsHref,
  type BoardKey,
} from '../lib/standings';
import { createAdminClient } from '../lib/supabase/admin';
import { createServerSupabase } from '../lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }:
  { searchParams: Promise<{ board?: string | string[]; year?: string | string[]; hand?: string | string[] }> }) {
  const { board: rawBoard, year: rawYear, hand: rawHand } = await searchParams;
  // The three route keys are unchanged (`lifetime`, `form`, `skill`) even though all three tab
  // labels changed, so every link and bookmark written before this release still works.
  const board: BoardKey = normalizeBoard(rawBoard);
  const userPromise = createServerSupabase().then(async (supabase) => {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  });

  // Two small reads that every board needs, in parallel with each other and with the sign-in
  // read above:
  //
  //  - which academic years contain finished games, because one year row now sits under all
  //    three tabs rather than under the points board alone; and
  //  - the twelve hand types, because a Notable wins filter is only carried onward if it has
  //    been checked against the real catalogue. A player filters Notable wins, glances at
  //    another board, and comes back — those intermediate tab addresses have to keep the
  //    selection alive even though neither point board looks at the values. Notable wins also
  //    RENDERS the catalogue, so the read takes each type's rarity to group it by and its local
  //    name to show beside the English one.
  //
  // Read BEFORE the board, because which board query to run depends on which year is selected.
  // That is one extra round trip in sequence, and it is affordable: measured on 2026-08-27 after
  // the functions moved to Singapore, a page running three queries answered in 83ms and one
  // running none answered in 84ms.
  //
  // A failed read of either yields no pills, or no filters, rather than an error. Selection then
  // falls through to all time, which is the same board the app showed before this feature.
  const [{ data: yearRows, error: yearsError }, { data: handRows, error: handsError }] = await Promise.all([
    createAdminClient().from('academic_years').select('academic_year'),
    createAdminClient().from('notable_hands').select('id, name, local_name, rarity'),
  ]);
  if (yearsError) console.error('[years]', yearsError.message);
  if (handsError) console.error('[hands]', handsError.message);
  const years: number[] = (yearRows ?? [])
    .map((row: Record<string, unknown>) => Number(row.academic_year))
    .filter((year: number) => Number.isFinite(year));
  // The database's own check constraint is what really keeps rarity to the three groups; this
  // only makes sure a row the panel could not place cannot reach it. Dropping such a row from
  // the catalogue also drops it from the ids below, so a filter for a type nobody can see or
  // uncheck is never honoured either.
  const handTypes: HandType[] = (handRows ?? []).flatMap((row: Record<string, unknown>) => {
    const { id, name, local_name: localName, rarity } = row;
    if (typeof id !== 'string' || typeof name !== 'string') return [];
    if (rarity !== 'uncommon' && rarity !== 'rare' && rarity !== 'legendary') return [];
    return [{ id, name, local_name: typeof localName === 'string' ? localName : null, rarity }];
  });
  const knownHandIds = new Set(handTypes.map((hand) => hand.id));
  const selectedHandIds = normalizeHandFilters(rawHand, knownHandIds);

  // Spec §4.1. The default is the current academic year, EXCEPT while that year is still empty:
  // otherwise the first morning of every new academic year opens RVMJ on "No finished games
  // yet", which reads as the app having lost the history rather than the year not having begun.
  //
  // An explicit `year=all` is honoured; anything unusable, or a year with no games, is treated
  // as absent. Same fail-soft posture `board` already takes.
  //
  // `hand` is the ONE parameter meant to appear more than once, so a repeated `?year=` is
  // malformed rather than a choice: it is handed on as absent and falls to the default period,
  // instead of the page silently picking one of the two values on the player's behalf.
  const requestedYear = parseYearParam(typeof rawYear === 'string' ? rawYear : undefined);
  // This forced-dynamic Server Component intentionally reads the clock at request time, in ONE
  // place, so every part of the page agrees about which academic year "now" is in.
  const currentYear = academicYearOf(new Date());
  const selectedYear: number | 'all' =
    requestedYear === 'all' ? 'all'
      : typeof requestedYear === 'number' && years.includes(requestedYear) ? requestedYear
      : years.includes(currentYear) ? currentYear
      : 'all';

  // Public boards are rendered here on the server with the service role. The browser never gets
  // that credential or direct anon database access; only these aggregate rows reach the page.
  //
  // Pts per game is the one board that is not a view: it needs each player's own newest twenty
  // finished games, which is a per-player window a flat view cannot express. All of that — the
  // window, the average, and the ranking — lives inside the database function, so the page hands
  // it exactly one thing: which period. `null` means all time, which drops the year boundary and
  // NOT the twenty-game window.
  const rowsPromise = board === 'form'
    ? createAdminClient().rpc('points_per_game_board', {
        p_academic_year: selectedYear === 'all' ? null : selectedYear,
      })
    : board === 'skill'
      // Notable wins ranks individual WINS, not players, so it is a function rather than a view
      // too: eligibility (match at least one selected type) and ordering (most selected matches,
      // then most total labels, then newest, then claim ID) live in one place next to the rows
      // they order. The page sends the two things it knows — which period, and which types the
      // player checked — and renders the answer in the order it arrives.
      ? createAdminClient().rpc('notable_wins_board', {
          p_academic_year: selectedYear === 'all' ? null : selectedYear,
          p_hand_ids: selectedHandIds,
        })
      : selectedYear === 'all'
        ? createAdminClient().from('lifetime_board').select('*')
            .order('total_points', { ascending: false }).limit(50)
        : createAdminClient().from('lifetime_board_by_year').select('*')
            .eq('academic_year', selectedYear)
            .order('total_points', { ascending: false }).limit(50);
  // "Has no house" and "we could not find out" are different answers. Only the first offers the
  // action: selection is optional, and a failed read must not nag a player who already chose.
  const housePromise = userPromise.then(async (user) => {
    if (!user) return { house: null, known: false };
    try {
      const { data, error: readError } = await createAdminClient()
        .from('players').select('house').eq('id', user.id).maybeSingle();
      if (readError) {
        console.error('[house]', readError.message);
        return { house: null, known: false };
      }
      return { house: findHouse(data?.house), known: true };
    } catch (cause) {
      console.error('[house]', cause instanceof Error ? cause.message : cause);
      return { house: null, known: false };
    }
  });
  const [user, myHouse, { data: rows, error }] = await Promise.all([userPromise, housePromise, rowsPromise]);

  // The rendered failure line is deliberately vague; the operator's copy must not be. Without this,
  // the "permission denied for table <t>" that a 0002 security_invoker regression produces is
  // indistinguishable from a network blip in the function logs.
  if (error) console.error('[boards]', board, error.message);

  // Each notable win carries its labels as one JSON value, read here before anything renders. A
  // row whose labels cannot be read is a broken board, never a win with fewer labels than it
  // actually has: a win rendered a label short understates what somebody did at the table, and on
  // a ranking ordered by label count it would also sit in the wrong place.
  const rankedWins = board === 'skill' && !error ? parseNotableWins(rows ?? []) : [];
  if (rankedWins === null) console.error('[boards]', board, 'unreadable hand_types');
  const boardFailed = Boolean(error) || rankedWins === null;
  const notableWins = rankedWins ?? [];

  // The gallery does not INHERIT these; it shows every photographed win exactly as it always has.
  // They are the address to come back TO. Without them the gallery's own back arrow drops a player
  // onto a bare Notable wins board with their period and filters gone, which reads as the app
  // having thrown the selection away rather than as leaving a page.
  //
  // Sent as parts rather than as one whole return URL, because the gallery rebuilds the address
  // from them: a parameter used verbatim as an href is an open redirect, and reconstructing costs
  // nothing when both ends already have the pieces.
  const galleryParams = new URLSearchParams({ year: String(selectedYear) });
  for (const handId of selectedHandIds) galleryParams.append('hand', handId);
  const galleryHref = `/hands?${galleryParams.toString()}`;

  return (
    <AppFrame>
      <header>
        {/* The mark left, the account control right. Shown only when signed in: it leads to a
            page about your own account, so offering it to a visitor leads only to a login wall. */}
        <div className="flex items-start justify-between gap-4">
          <BrandMark />
          {user ? <SettingsLink /> : null}
        </div>
        <h1 className="mt-8 text-4xl font-extrabold tracking-[-0.04em]">Table standings</h1>
      </header>
      {!user ? (
        <section className="mt-7 rounded-[14px] border border-divider bg-surface p-5">
          <p className="leading-7 text-muted">Sign in to join a table. To play, tap your seat at the table.</p>
          <ActionLink href="/login" className="mt-5">Sign in</ActionLink>
        </section>
      ) : null}
      {user && myHouse.known && !myHouse.house ? (
        <div className="mt-7"><ChooseHouseAction /></div>
      ) : null}
      <nav aria-label="Leaderboard" className="mt-7 grid grid-cols-3 gap-2 rounded-[12px] bg-cobalt-soft p-1.5">
        {/* The whole route is prefetched, contents included, not just the empty frame Next gives a
            dynamic route by default. This page reads cookies to know who is signed in, so Next
            cannot predict it and will not pre-fetch the board itself unless told to.

            Measured on a local production build with NO network latency: a tab switch went from a
            median 65ms (range 23-161ms) to a median 15ms (range 14-27ms). The collapsed range is
            the real win -- a control that is usually quick and occasionally slow reads as broken.
            A phone adds mobile latency to every one of the old numbers and to none of the new
            ones, because the payload is already in the browser before the tap.

            The cost is three boards rendered per leaderboard view instead of one, and ~80KB more
            down the wire. At four players a table that is nothing. The freshness trade is likewise
            safe HERE and nowhere near the game screens: this board only moves when a whole match
            ends, so a payload a few seconds old cannot show anyone a wrong live count. */}
        {/* Every tab carries the chosen period and hand filters, so switching board changes ONLY
            the board. Total score and Pts per game do not read the filters; they pass them on. */}
        {(Object.keys(BOARDS) as BoardKey[]).map((k) => (
          <Link key={k} href={standingsHref({ board: k, year: selectedYear, handIds: selectedHandIds })} prefetch
            aria-current={k === board ? 'page' : undefined}
            className={`flex min-h-11 items-center justify-center rounded-[9px] px-3 py-2 text-sm font-bold ${k === board ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
            {BOARDS[k].title}
          </Link>
        ))}
      </nav>
      {/* One period selector for all three boards; it renders nothing until a year has games. */}
      <YearPills years={years} selected={selectedYear} board={board} handIds={selectedHandIds} />
      <section className="mt-4 rounded-[14px] border border-divider bg-surface p-4 sm:p-5">
        {board === 'skill' ? (
          handsError ? (
            // A failed catalogue read leaves no known IDs, so every hand filter in the address was
            // dropped and the panel would have nothing to draw. Rendering that as an ordinary
            // empty selection would tell the player their filters are off, when what happened is
            // that the app could not check them. Fail soft and visible instead: the ranking still
            // works, unfiltered, and the board says which part of it did not.
            <StatusMessage tone="warning" className="mb-4">
              Couldn’t load hand types just now. Showing every notable win.
            </StatusMessage>
          ) : (
            <HandTypeFilter handTypes={handTypes} selectedIds={selectedHandIds} year={selectedYear} />
          )
        ) : null}
        {boardFailed ? (
          // An empty table would read as "nobody has played". Say the board failed to load
          // instead. One sentence for every board, so a reader who switches tabs after a failure
          // is not left wondering whether the second message means something different.
          <StatusMessage tone="error">Couldn’t load this board</StatusMessage>
        ) : board === 'skill' ? (
          notableWins.length === 0 ? (
            <StatusMessage tone="info">
              {/* Two different facts. A filtered board that found nothing is not a board with
                  nothing on it, and saying so is what tells the player to loosen the filter
                  rather than to go and win something. */}
              {selectedHandIds.length > 0
                ? 'No notable wins match these hand types.'
                : 'No notable wins yet.'}
            </StatusMessage>
          ) : (
            // Ranked exactly as the database returned, one row per physical win. Several labels
            // never become several rows: that would let one hand crowd out everybody else's.
            <ol className="flex flex-col gap-2">
              {notableWins.map((notableWin, i) => (
                <NotableWinRow key={notableWin.claimId} rank={i + 1} winnerName={notableWin.winnerName}
                  wonAt={notableWin.wonAt} handTypes={notableWin.handTypes} />
              ))}
            </ol>
          )
        ) : (rows ?? []).length === 0 ? (
          <StatusMessage tone="info">
            {/* Pts per game averages the same finished games, so it says the same thing. */}
            No finished games yet.
          </StatusMessage>
        ) : (
          // Each row is now its own box, so the list carries the spacing the divider used to.
          // Rows are rendered in the order the database returned and never re-sorted here: the
          // ranking rules, ties included, live in one place next to the numbers they order.
          <ol className="flex flex-col gap-2">
            {(rows ?? []).map((r: Record<string, unknown>, i: number) => {
              if (board === 'form') {
                // Tone is read back off the FORMATTED average rather than the raw one, so what
                // the row says and how it is painted can never disagree: an average of -0.04
                // reads as `0.0`, and must therefore be neutral rather than a loss.
                const shown = formatPointsPerGame(Number(r.avg_points) || 0);
                const counted = Number(r.games_counted) || 0;
                return (
                  <BoardRow key={String(r.id)} rank={i + 1} name={String(r.display_name)}
                    // Under twenty the row says how many games it actually averaged, so a
                    // two-game average is not mistaken for a settled one. At twenty it names the
                    // window instead, because the count stops moving while the games behind it
                    // keep changing.
                    context={counted >= 20 ? 'Latest 20 games' : `${counted} game${counted === 1 ? '' : 's'} counted`}
                    score={shown}
                    scoreTone={shown === '0.0' ? 'neutral' : shown.startsWith('+') ? 'gain' : 'loss'}
                    house={findHouse(typeof r.house === 'string' ? r.house : null)} />
                );
              }
              // Total score is all that is left down here: Pts per game returned above, and
              // Notable wins no longer renders player rows at all.
              const value = Number(r.total_points) || 0;
              const shown = value > 0 ? `+${value}` : String(value);
              return (
                <BoardRow key={String(r.id)} rank={i + 1} name={String(r.display_name)}
                  context={`${Number(r.games_played) || 0} games`} score={shown}
                  scoreTone={value === 0 ? 'neutral' : value > 0 ? 'gain' : 'loss'}
                  house={findHouse(typeof r.house === 'string' ? r.house : null)} />
              );
            })}
          </ol>
        )}
        {board === 'skill' ? (
          <ActionLink href={galleryHref} variant="secondary" className="mt-4">View hand gallery</ActionLink>
        ) : null}
      </section>
      <div className="mt-4 flex flex-wrap gap-3">
        <ActionLink href="/chips" variant="secondary">House rules</ActionLink>
      </div>
      <MadeByBanner />
    </AppFrame>
  );
}
