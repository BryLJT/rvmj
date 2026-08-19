'use client';

import { useRef, useState } from 'react';
import { Button, LiveRegion, StatusMessage } from '../../../components/ui';
import { reopenChipGame } from '../../../lib/actions/game';
import { createClient } from '../../../lib/supabase/client';

export function ReopenGameControl({ gameId, onReopened, disabled = false }: {
  gameId: string;
  onReopened: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // router.refresh() is not awaited. Restoring the confirm button invites a second press, which
  // reopen_game rejects with a raw error for an operation that actually succeeded.
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const submittingRef = useRef(false);
  const supabase = createClient();

  const latchReopened = () => {
    setDone(true);
    onReopened();
  };

  const reopenedOnServer = async () => {
    try {
      const { data, error: readError } = await supabase.from('games')
        .select('status').eq('id', gameId).single();
      return !readError && data?.status === 'active';
    } catch {
      return false;
    }
  };

  const reopen = async () => {
    if (submittingRef.current || disabled) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      let failure: string | undefined;
      try {
        const result = await reopenChipGame(gameId);
        failure = result.error;
      } catch (cause) {
        failure = cause instanceof Error ? cause.message : 'Could not reach the table. Try again.';
      }

      if (!failure) {
        latchReopened();
      } else if (await reopenedOnServer()) {
        // The action response was lost or stale, but the row is authoritative: reopening did land.
        latchReopened();
      } else {
        // Expired windows and new-game conflicts stay readable. A failed reconciliation never
        // turns an actual rejection into a guessed success.
        setError(failure);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (!armed) {
    return <Button variant="secondary" disabled={disabled} onClick={() => setArmed(true)}>Reopen game</Button>;
  }

  return (
    <div className="flex flex-col gap-3">
      <StatusMessage tone="warning" title="Reopen this game?">
        Reopening unlocks the result and removes it from the leaderboard until everyone confirms again.
      </StatusMessage>
      <LiveRegion tone="error" message={error} />
      {submitting || done ? (
        <Button variant="destructive" busy busyLabel="Reopening…">Yes, reopen game</Button>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="destructive" disabled={disabled} onClick={reopen}>Yes, reopen game</Button>
          <Button variant="secondary" onClick={() => { setArmed(false); setError(undefined); }}>Cancel</Button>
        </div>
      )}
    </div>
  );
}
