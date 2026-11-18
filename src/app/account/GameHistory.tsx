'use client';
import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import { getGameHistory } from '../../lib/actions/history';
import { formatHistoryDate, pointsLabel, type HistoryResult } from '../../lib/game-history';
import { GAME_VARIANTS } from '../../lib/game-variant';
import { Button, StatusMessage } from '../../components/ui';
import { useHistoryState } from './HistoryState';
export function GameHistory({ viewerId, initial }: {
  viewerId: string;
  initial: HistoryResult;
}) {
  const cache = useHistoryState();
  const snapshot = cache?.snapshot;
  const [result, setResult] = useState(snapshot?.viewerId === viewerId ? snapshot.result ?? initial : initial);
  const [busy, setBusy] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  useLayoutEffect(() => {
    if (box.current && snapshot?.viewerId === viewerId)
      box.current.scrollTop = snapshot.scrollTop;
  }, [snapshot, viewerId]);
  const load = async (older: boolean) => {
    if (inFlight.current)
      return;
    inFlight.current = true;
    setBusy(true);
    let next: HistoryResult;
    try {
      next = await getGameHistory(older && result.status === 'ready' ? result.nextCursor ?? undefined : undefined);
    }
    catch {
      next = { status: 'error' };
    }
    if (older && next.status === 'error')
      setOlderFailed(true);
    else {
      setOlderFailed(false);
      if (older && result.status === 'ready' && next.status === 'ready') {
        const previous = new Set(result.games.map(game => game.id));
        next = { ...next, games: [...result.games, ...next.games.filter(game => !previous.has(game.id))] };
      }
      setResult(next);
      cache?.setSnapshot({ viewerId, result: next, scrollTop: older ? box.current?.scrollTop ?? 0 : 0 });
      if (!older && box.current)
        box.current.scrollTop = 0;
    }
    inFlight.current = false;
    setBusy(false);
  };
  const remember = () => cache?.setSnapshot({ viewerId, result, scrollTop: box.current?.scrollTop ?? 0 });
  return <section aria-labelledby="history-title" className="mt-8 overflow-hidden rounded-[14px] border border-divider bg-surface">
  <header className="flex items-center justify-between gap-3 border-b border-divider px-4 py-4 sm:px-5">
   <div><h2 id="history-title" className="text-xl font-extrabold tracking-tight">Game history</h2><p className="mt-1 text-xs text-muted">Your results in points</p></div>
   <Button variant="quiet" className="px-2 text-xs" busy={busy} busyLabel="Loading…" onClick={() => load(false)}>Refresh</Button>
  </header>
  <div ref={box} role="region" aria-label="Past games, scroll to see older games" tabIndex={0} onScroll={remember} className="h-[337px] overflow-x-hidden overflow-y-scroll overscroll-y-contain [scrollbar-gutter:stable] [scrollbar-width:thin] sm:h-[352px]">
   {result.status === 'ready' ? <>
    {result.games.length === 0 ? <p className="p-5 text-sm text-muted">No finished games yet.</p> : <ul>
     {result.games.map(game => {
          const total = game.players.find(player => player.playerId === viewerId)?.finalTotal ?? null;
          return <li key={game.id}><Link href={`/account/games/${game.id}`} onClick={remember} className="grid min-h-[106px] grid-cols-[minmax(0,1fr)_auto_0.5rem] items-center gap-3 border-b border-divider px-4 py-4 text-ink hover:bg-cobalt-soft/30 sm:px-5">
       <div className="min-w-0"><p className="text-sm font-bold">{formatHistoryDate(game.endedAt)}</p>
        <span className={`mt-2 inline-block rounded px-2 py-0.5 text-[10px] font-bold ${game.variant === 'fei' ? 'bg-amber-soft text-amber' : 'bg-cobalt-soft text-cobalt'}`}>{GAME_VARIANTS[game.variant].title}</span>
        <p className="mt-1.5 break-words text-xs leading-5 text-muted [overflow-wrap:anywhere]">{game.players.filter(player => player.playerId !== viewerId).map(player => player.name).join(', ')}</p>
       </div>
       <span className={`max-w-[8rem] text-right text-lg font-extrabold tabular-nums ${total === null ? 'text-xs text-muted' : total > 0 ? 'text-gain' : total < 0 ? 'text-coral' : 'text-ink'}`}>{pointsLabel(total)}</span><span aria-hidden className="text-muted">›</span>
      </Link></li>;
        })}
    </ul>}
    {olderFailed ? <div className="p-4"><StatusMessage tone="error">Couldn’t load older games. Your loaded games are still here.</StatusMessage><Button className="mt-3" variant="secondary" busy={busy} onClick={() => load(true)}>Retry</Button></div>
        : result.nextCursor ? <div className="p-4"><Button variant="secondary" busy={busy} onClick={() => load(true)}>Load older games</Button></div> : null}
   </> : <div className="p-4"><StatusMessage tone="error">{result.status === 'expired' ? 'Your sign-in expired. Sign in again to see your games.' : 'Couldn’t load your game history.'}</StatusMessage>
    {result.status === 'expired' ? <Link className="mt-3 inline-flex min-h-11 items-center font-bold text-cobalt" href="/login?next=%2Faccount">Sign in</Link> : <Button className="mt-3" variant="secondary" busy={busy} onClick={() => load(false)}>Retry</Button>}</div>}
  </div>
  <footer className="flex justify-between gap-3 border-t border-divider px-4 py-3 text-[11px] text-muted sm:px-5"><span>Newest first</span><span>Scroll for older games ↓</span></footer>
 </section>;
}
