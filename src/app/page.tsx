import Link from 'next/link';
import { BoardRow } from '../components/BoardRow';
import { ChooseHouseAction } from '../components/ChooseHouseAction';
import { YearPills } from '../components/YearPills';
import { MadeByBanner } from '../components/MadeByBanner';
import { SettingsLink } from '../components/SettingsLink';
import { ActionLink, AppFrame, BrandMark, StatusMessage } from '../components/ui';
import { academicYearOf, parseYearParam } from '../lib/academic-year';
import { findHouse } from '../lib/houses';
import { createAdminClient } from '../lib/supabase/admin';
import { createServerSupabase } from '../lib/supabase/server';

export const dynamic = 'force-dynamic';

const BOARDS = { lifetime: { title: 'Lifetime' }, form: { title: 'Form' }, skill: { title: 'Skill' } } as const;
type BoardKey = keyof typeof BOARDS;

export default async function Home({ searchParams }:
  { searchParams: Promise<{ board?: string; year?: string }> }) {
  const { board: raw, year: rawYear } = await searchParams;
  const board: BoardKey = raw === 'form' || raw === 'skill' ? raw : 'lifetime';
  const userPromise = createServerSupabase().then(async (supabase) => {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  });

  // Which academic years contain finished games. Read BEFORE the board, because which board to
  // read depends on which year is selected. That is one extra round trip in sequence, and it is
  // affordable: measured on 2026-08-27 after the functions moved to Singapore, a page running
  // three queries answered in 83ms and one running none answered in 84ms.
  //
  // A failed read yields no pills rather than an error. Selection then falls through to all
  // time, which is the same board the app showed before this feature existed.
  let years: number[] = [];
  if (board === 'lifetime') {
    const { data: yearRows, error: yearsError } = await createAdminClient()
      .from('academic_years').select('academic_year');
    if (yearsError) console.error('[years]', yearsError.message);
    years = (yearRows ?? [])
      .map((row: Record<string, unknown>) => Number(row.academic_year))
      .filter((year: number) => Number.isFinite(year));
  }

  // Spec §4.1. The default is the current academic year, EXCEPT while that year is still empty:
  // otherwise the first morning of every new academic year opens RVMJ on "No finished games
  // yet", which reads as the app having lost the history rather than the year not having begun.
  //
  // An explicit `year=all` is honoured; anything unusable, or a year with no games, is treated
  // as absent. Same fail-soft posture `board` already takes.
  const requestedYear = parseYearParam(rawYear);
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
  // Form ranks per-hand play and goes live with app mode (Task 23). Until then: no query at all.
  const rowsPromise = board === 'form'
    ? Promise.resolve({ data: null, error: null })
    : board === 'skill'
      ? createAdminClient().from('skill_board').select('*')
          .order('notable_wins', { ascending: false }).limit(50)
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
        {(Object.keys(BOARDS) as BoardKey[]).map((k) => (
          <Link key={k} href={`/?board=${k}`} prefetch
            aria-current={k === board ? 'page' : undefined}
            className={`flex min-h-11 items-center justify-center rounded-[9px] px-3 py-2 text-sm font-bold ${k === board ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
            {BOARDS[k].title}
          </Link>
        ))}
      </nav>
      {board === 'lifetime' ? <YearPills years={years} selected={selectedYear} /> : null}
      <section className="mt-4 rounded-[14px] border border-divider bg-surface p-4 sm:p-5">
        {board === 'form' ? (
          <StatusMessage tone="info">Form uses per-hand games. Chip mode is the only live mode right now.</StatusMessage>
        ) : error ? (
          // An empty table would read as "nobody has played". Say the board failed to load instead.
          <StatusMessage tone="error">Couldn’t load the {BOARDS[board].title} board just now. Refresh to try again.</StatusMessage>
        ) : (rows ?? []).length === 0 ? (
          <StatusMessage tone="info">
            {board === 'lifetime' ? 'No finished games yet.' : 'No notable hands claimed yet.'}
          </StatusMessage>
        ) : (
          // Each row is now its own box, so the list carries the spacing the divider used to.
          <ol className="flex flex-col gap-2">
            {(rows ?? []).map((r: Record<string, unknown>, i: number) => {
              const value = Number(board === 'lifetime' ? r.total_points : r.notable_wins) || 0;
              const shown = board === 'lifetime' && value > 0 ? `+${value}` : String(value);
              const scoreTone = board !== 'lifetime' || value === 0 ? 'neutral' : value > 0 ? 'gain' : 'loss';
              const context = board === 'lifetime'
                ? `${Number(r.games_played) || 0} games`
                : `${value} notable${Number(r.total_tai) > 0 ? ` · ${r.total_tai} tai` : ''}`;
              return (
                <BoardRow key={String(r.id)} rank={i + 1} name={String(r.display_name)}
                  context={context} score={shown} scoreTone={scoreTone}
                  house={findHouse(typeof r.house === 'string' ? r.house : null)} />
              );
            })}
          </ol>
        )}
        {board === 'skill' ? (
          <ActionLink href="/hands" variant="secondary" className="mt-4">View hand gallery</ActionLink>
        ) : null}
      </section>
      <div className="mt-4 flex flex-wrap gap-3">
        <ActionLink href="/chips" variant="secondary">House rules</ActionLink>
      </div>
      <MadeByBanner />
    </AppFrame>
  );
}
