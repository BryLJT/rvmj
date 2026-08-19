'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionLink, AppFrame, Button, LiveRegion, PageHeader, PlayerRow, StatusMessage } from '../../../components/ui';
import { startGame } from '../../../lib/actions/game';
import { createClient } from '../../../lib/supabase/client';

type P = { playerId: string; seat: 'E' | 'S' | 'W' | 'N'; name: string };
const SEATS = ['E', 'S', 'W', 'N'] as const;

export function FormingScreen({ gameId, players }: { gameId: string; players: P[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const full = players.length === 4;

  // refresh when other players tap in, or the game starts
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`forming-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
        () => router.refresh())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        () => router.refresh())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') router.refresh();
      });
    return () => { supabase.removeChannel(ch); };
  }, [gameId, router]);

  useEffect(() => {
    const refreshVisibleTable = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', refreshVisibleTable);
    return () => document.removeEventListener('visibilitychange', refreshVisibleTable);
  }, [router]);

  const onStart = async () => {
    if (submittingRef.current || !full) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await startGame(gameId, 'chips');
      if (result.error) setError(result.error);
      else router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the table. Try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <AppFrame>
      <PageHeader eyebrow="Forming table" title="Take your seats" />

      <ul className="rounded-[14px] border border-divider bg-surface-raised px-4 sm:px-5">
        {SEATS.map((seat) => {
          const player = players.find((candidate) => candidate.seat === seat);
          return <PlayerRow key={seat} seat={seat} name={player?.name ?? 'Tap this seat to join'} muted={!player} />;
        })}
      </ul>

      <div className="mt-6 flex flex-col gap-3">
        <StatusMessage tone="info" title="Chip mode">
          Settle hands with physical chips. RVMJ records the final count when the game ends.
        </StatusMessage>
        <ActionLink href="/chips" variant="secondary" className="w-full">View the standard chip set</ActionLink>
      </div>

      <div className="mt-auto flex flex-col gap-3 pt-6">
        <Button onClick={onStart} disabled={!full} busy={submitting} busyLabel="Starting game…" className="w-full">
          {full ? 'Start chip game' : `Waiting for players (${players.length}/4)`}
        </Button>
        <LiveRegion tone="error" message={error} />
      </div>
    </AppFrame>
  );
}
