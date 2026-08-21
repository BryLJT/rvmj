import Link from 'next/link';
import { BoardRow } from '../components/BoardRow';
import { ChooseHouseAction } from '../components/ChooseHouseAction';
import { ActionLink, AppFrame, BrandMark, StatusMessage } from '../components/ui';
import { findHouse } from '../lib/houses';
import { createAdminClient } from '../lib/supabase/admin';
import { createServerSupabase } from '../lib/supabase/server';

export const dynamic = 'force-dynamic';

const BOARDS = { lifetime: { title: 'Lifetime' }, form: { title: 'Form' }, skill: { title: 'Skill' } } as const;
type BoardKey = keyof typeof BOARDS;

export default async function Home({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const { board: raw } = await searchParams;
  const board: BoardKey = raw === 'form' || raw === 'skill' ? raw : 'lifetime';
  const userPromise = createServerSupabase().then(async (supabase) => {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  });

  // Public boards are rendered here on the server with the service role. The browser never gets
  // that credential or direct anon database access; only these aggregate rows reach the page.
  // Form ranks per-hand play and goes live with app mode (Task 23). Until then: no query at all.
  const rowsPromise = board !== 'form'
    ? createAdminClient().from(board === 'lifetime' ? 'lifetime_board' : 'skill_board').select('*')
        .order(board === 'lifetime' ? 'total_points' : 'notable_wins', { ascending: false }).limit(50)
    : Promise.resolve({ data: null, error: null });
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
        <BrandMark />
        <h1 className="mt-8 text-4xl font-extrabold tracking-[-0.04em]">Table standings</h1>
      </header>
      {!user ? (
        <section className="mt-7 rounded-[14px] border border-divider bg-surface-raised p-5">
          <p className="leading-7 text-muted">Sign in to join a table. To play, tap your seat at the table.</p>
          <ActionLink href="/login" className="mt-5">Sign in</ActionLink>
        </section>
      ) : null}
      {user && myHouse.known && !myHouse.house ? (
        <div className="mt-7"><ChooseHouseAction /></div>
      ) : null}
      <nav aria-label="Leaderboard" className="mt-7 grid grid-cols-3 gap-2 rounded-[12px] bg-cobalt-soft p-1.5">
        {(Object.keys(BOARDS) as BoardKey[]).map((k) => (
          <Link key={k} href={`/?board=${k}`}
            aria-current={k === board ? 'page' : undefined}
            className={`flex min-h-11 items-center justify-center rounded-[9px] px-3 py-2 text-sm font-bold ${k === board ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
            {BOARDS[k].title}
          </Link>
        ))}
      </nav>
      <section className="mt-4 rounded-[14px] border border-divider bg-surface-raised p-4 sm:p-5">
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
        <ActionLink href="/chips" variant="secondary">View the standard chip set</ActionLink>
      </div>
    </AppFrame>
  );
}
