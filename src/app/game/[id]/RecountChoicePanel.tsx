'use client';

import { FullScreenPanel } from '../../../components/FullScreenPanel';
import { Button, LiveRegion, StatusMessage } from '../../../components/ui';

export function RecountChoicePanel({
  syncBlocked, syncError, onUseTableNumbers, onUseMyNumbers,
}: {
  syncBlocked: boolean;
  syncError?: string;
  onUseTableNumbers: () => void;
  onUseMyNumbers: () => void;
}) {
  return (
    <FullScreenPanel title="Choose your starting numbers" eyebrow="Recount">
      <p className="max-w-xl text-sm leading-6 text-muted">
        This phone has unsent numbers that differ from the table’s current count. Choose which set to edit.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {syncBlocked && !syncError ? (
          <StatusMessage tone="info">Checking the latest table count…</StatusMessage>
        ) : null}
        <LiveRegion tone="error" message={syncError} />
        <Button className="w-full" disabled={syncBlocked} onClick={onUseTableNumbers}>
          Start recount from the table’s current numbers
        </Button>
        <Button variant="secondary" className="w-full" disabled={syncBlocked} onClick={onUseMyNumbers}>
          Start recount from my unsent numbers
        </Button>
      </div>
    </FullScreenPanel>
  );
}
