'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ChipSetCard } from '../../../components/ChipSetCard';
import { FullScreenPanel } from '../../../components/FullScreenPanel';
import { TaiScaleCard } from '../../../components/TaiScaleCard';
import { Button } from '../../../components/ui';
import { markWelcomeSeen, noWelcomeSeenOnServer, readWelcomeSeen, subscribeToWelcomeSeen } from '../../../lib/welcome';
import { rulesHref } from '../../../lib/rules-link';

/**
 * The rules, on every phone, at the start of every match.
 *
 * Per phone and per match: all four players land here at the same instant because starting the
 * game flips one database row, but each dismisses on their own device. Nothing is written to the
 * database and nobody waits for anybody — four confirmations to begin would repeat exactly the
 * mistake per-hand approval would have been.
 *
 * The component owns both halves of when it appears, rather than leaving the status half to its
 * caller: a settled game reopened into a fresh one must not greet anybody with rules for a match
 * that is already counted up.
 */
export function MatchWelcome({ gameId, status }: { gameId: string; status: 'active' | 'ended' }) {
  const seen = useSyncExternalStore(subscribeToWelcomeSeen, readWelcomeSeen, noWelcomeSeenOnServer);
  if (status !== 'active' || seen === gameId) return null;

  const dismiss = () => markWelcomeSeen(gameId);

  return (
    <FullScreenPanel
      eyebrow="Match start"
      title="House rules"
      onDismiss={dismiss}
      footer={<Button className="w-full" onClick={dismiss}>Let’s play</Button>}
    >
      <p className="mb-6 max-w-2xl text-sm leading-6 text-muted">
        Chips settle every hand at the table. RVMJ stays out of the way until you count up.
      </p>
      <div className="flex flex-col gap-4">
        <TaiScaleCard />
        <ChipSetCard />
        <p className="text-xs leading-5 text-muted">
          Kongs, flowers and animal pairs are on the{' '}
          <Link href={rulesHref(gameId)} className="font-bold text-cobalt">House rules</Link> page, reachable any time during play.
        </p>
      </div>
    </FullScreenPanel>
  );
}
