'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppFrame, Button, PageHeader, StatusMessage } from '../../../../components/ui';
import { GAME_VARIANTS } from '../../../../lib/game-variant';
import { formatHistoryDate, pointsLabel, type GameDetailResult } from '../../../../lib/game-history';
import { HistoricalNotableForm } from './HistoricalNotableForm';
export function GameHistoryDetail({ detail, viewerId }: {
  detail: GameDetailResult;
  viewerId: string;
}) {
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  return <AppFrame><Link href="/account" className="mb-5 inline-flex min-h-11 items-center font-semibold text-cobalt">← Back to Settings</Link>
  <PageHeader title="Game details"/>
  {detail.status === 'reopened' ? <StatusMessage tone="info">This game is in progress again. <Link className="font-bold text-cobalt" href={`/game/${detail.gameId}`}>Open game</Link></StatusMessage>
      : detail.status !== 'ready' ? <><StatusMessage tone="error">Couldn’t load this game just now.</StatusMessage><Button className="mt-4" variant="secondary" onClick={() => router.refresh()}>Retry</Button></>
        : <>
    <p className="-mt-3 mb-7 text-sm text-muted">{formatHistoryDate(detail.game.endedAt)} <span className="ml-2 rounded bg-cobalt-soft px-2 py-1 text-xs font-bold text-cobalt">{GAME_VARIANTS[detail.game.variant].title}</span></p>
    <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-xl font-extrabold">Final results</h2><span className="rounded bg-gain-soft px-2 py-1 text-[11px] font-bold text-gain">Game finished</span></div>
    <ul className="rounded-[14px] border border-divider bg-surface px-4 sm:px-5">{detail.game.players.map(player => <li key={player.playerId} className="flex min-h-20 items-center gap-3 border-b border-divider py-3 last:border-0">
     <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-divider bg-cobalt-soft text-sm font-extrabold">{player.seat}</span>
     <span className="min-w-0 flex-1 break-words text-sm font-bold [overflow-wrap:anywhere]">{player.name}{player.playerId === viewerId ? <small className="ml-1 font-normal text-muted">(you)</small> : null}</span>
     <span className={`max-w-[8rem] text-right font-extrabold tabular-nums ${player.finalTotal === null ? 'text-xs text-muted' : player.finalTotal > 0 ? 'text-gain' : player.finalTotal < 0 ? 'text-coral' : 'text-ink'}`}>{pointsLabel(player.finalTotal)}</span>
    </li>)}</ul><p className="mt-3 text-xs text-muted">Net results in points.</p>
    <section className="mt-8"><h2 className="mb-4 text-xl font-extrabold">Notable wins</h2>
     {detail.wins === null ? <StatusMessage tone="error">Couldn’t load this game’s notable wins. Refresh before adding another.</StatusMessage>
            : detail.wins.length === 0 ? <p className="rounded-xl border border-divider bg-surface p-5 text-sm text-muted">No notable wins recorded for this game yet.</p>
              : <ul className="flex flex-col gap-3">{detail.wins.map(win => <li key={win.id}><Link href={`/hands/${win.id}?from=history`} className="flex min-h-20 items-center gap-3 rounded-xl border border-divider bg-surface p-4 hover:border-cobalt">
       <span className="grid h-11 w-10 shrink-0 place-items-center rounded border border-divider border-b-4 border-b-gain text-2xl text-gain" aria-hidden>發</span><span className="min-w-0 flex-1"><strong className="block text-sm">{win.winnerName}</strong><span className="mt-1 block text-xs leading-5 text-muted">{win.handTypes.map(hand => hand.name).join(' + ')}</span><span className="mt-1 block text-xs text-muted">{win.hasPhoto ? 'Photo added' : 'No photo yet · Tap to add one'}</span></span><span aria-hidden>›</span>
      </Link></li>)}</ul>}
     {detail.game.mode === 'chips' ? detail.catalogue === null ? <div className="mt-4"><StatusMessage tone="info">Adding a notable win is temporarily unavailable. Couldn’t load the hand types.</StatusMessage></div>
            : detail.wins !== null ? adding ? <HistoricalNotableForm key={detail.game.id} game={detail.game} catalogue={detail.catalogue} onSaved={() => { setAdding(false); router.refresh(); }} onCancel={() => setAdding(false)}/>
              : <><Button className="mt-4 w-full" onClick={() => setAdding(true)}>Add notable win</Button><p className="mt-3 text-xs leading-5 text-muted">Missed one during the game? Add it here, with or without a photo.</p></> : null : null}
    </section>
   </>}
 </AppFrame>;
}
