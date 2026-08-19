'use client';

import { useRef, useState } from 'react';
import { Button, LiveRegion, StatusMessage } from '../../../components/ui';
import { reopenChipGame } from '../../../lib/actions/game';

export function ReopenGameControl({ gameId, onReopened, disabled = false }: {
  gameId: string;
  onReopened: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const submittingRef = useRef(false);

  const reopen = async () => {
    if (submittingRef.current || disabled) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await reopenChipGame(gameId);
      if (result.error) setError(result.error);
      else onReopened();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the table. Try again.');
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
      {submitting ? (
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
