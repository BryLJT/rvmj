import Link from 'next/link';
import { ActionLink, AppFrame, BrandMark, StatusMessage } from '../components/ui';
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
  const [user, { data: rows, error }] = await Promise.all([userPromise, rowsPromise]);

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
          <ol>
            {(rows ?? []).map((r: Record<string, unknown>, i: number) => {
              const value = Number(board === 'lifetime' ? r.total_points : r.notable_wins) || 0;
              const shown = board === 'lifetime' && value > 0 ? `+${value}` : String(value);
              const scoreTone = board !== 'lifetime' ? 'text-ink' : value > 0 ? 'text-gain' : value < 0 ? 'text-coral' : 'text-muted';
              const context = board === 'lifetime'
                ? `${Number(r.games_played) || 0} games`
                : `${value} notable${Number(r.total_tai) > 0 ? ` · ${r.total_tai} tai` : ''}`;
              return (
                <li key={String(r.id)} className="grid min-h-16 grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-divider py-3 last:border-b-0">
                  <span className="text-sm font-bold tabular-nums text-muted" aria-label={`Rank ${i + 1}`}>{i + 1}</span>
                  <div className="min-w-0">
                    <p className="truncate font-bold text-ink">{String(r.display_name)}</p>
                    <p className="text-xs text-muted">{context}</p>
                  </div>
                  <span className={`text-xl font-extrabold tabular-nums ${scoreTone}`}>{shown}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <ActionLink href="/chips" variant="secondary" className="mt-4 self-start">View the standard chip set</ActionLink>
    </AppFrame>
  );
}
