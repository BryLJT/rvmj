import Link from 'next/link';
import { createServerSupabase } from '../lib/supabase/server';

export const dynamic = 'force-dynamic';

const BOARDS = { lifetime: { title: 'Lifetime' }, form: { title: 'Form' }, skill: { title: 'Skill' } } as const;
type BoardKey = keyof typeof BOARDS;

export default async function Home({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const { board: raw } = await searchParams;
  const board: BoardKey = raw === 'form' || raw === 'skill' ? raw : 'lifetime';
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // Form ranks per-hand play and goes live with app mode (Task 23). Until then: no query at all.
  const { data: rows, error } = user && board !== 'form'
    ? await supabase.from(board === 'lifetime' ? 'lifetime_board' : 'skill_board').select('*')
        .order(board === 'lifetime' ? 'total_points' : 'notable_wins', { ascending: false }).limit(50)
    : { data: null, error: null };

  // The rendered failure line is deliberately vague; the operator's copy must not be. Without this,
  // the "permission denied for table <t>" that a 0002 security_invoker regression produces is
  // indistinguishable from a network blip in the function logs.
  if (error) console.error('[boards]', board, error.message);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">RVMJ Leaderboard</h1>
      {!user ? (
        <p>
          <Link className="underline" href="/login">Sign in</Link> to see the boards. To play, tap your seat at the table.
        </p>
      ) : (
        <>
          <nav className="flex gap-2">
            {(Object.keys(BOARDS) as BoardKey[]).map((k) => (
              <Link key={k} href={`/?board=${k}`}
                className={`rounded border px-3 py-1 ${k === board ? 'bg-black text-white dark:bg-white dark:text-black' : ''}`}>
                {BOARDS[k].title}
              </Link>
            ))}
          </nav>
          {board === 'form' ? (
            <p className="py-4 text-sm opacity-60">
              Form ranks app-scorekeeper games (average points per hand, minimum 20 hands). None played yet.
            </p>
          ) : error ? (
            // An empty table would read as "nobody has played". Say the board failed to load instead.
            <p className="py-4 text-sm opacity-60">
              Couldn’t load the {BOARDS[board].title} board just now. Refresh to try again.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {(rows ?? []).map((r: Record<string, unknown>, i: number) => (
                  <tr key={String(r.id)} className="border-b">
                    <td className="py-2 pr-2 opacity-50">{i + 1}</td>
                    <td className="py-2">{String(r.display_name)}</td>
                    <td className="py-2 text-right font-mono">
                      {board === 'lifetime' && `${r.total_points} pts · ${r.games_played} games`}
                      {board === 'skill' && `${r.notable_wins} notable${Number(r.total_tai) > 0 ? ` · ${r.total_tai} tai` : ''}`}
                    </td>
                  </tr>
                ))}
                {(rows ?? []).length === 0 && (
                  <tr>
                    <td className="py-4 opacity-60">
                      {board === 'lifetime' ? 'No finished games yet.' : 'No notable hands claimed yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          <p className="text-sm"><Link className="underline" href="/chips">Table setup — the standard chip set</Link></p>
        </>
      )}
    </main>
  );
}
