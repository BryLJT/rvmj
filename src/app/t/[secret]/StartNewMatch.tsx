'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, StatusMessage } from '../../../components/ui';

/**
 * Two-step destructive action. Step one arms it, step two performs it.
 *
 * The arming step is deliberately client-side state, not a second page: the whole point is
 * that the second press is a considered one, and a round trip would tempt a player to tap
 * ahead of the render on a slow table connection.
 *
 * The action is only ever reachable from the confirm step. There is no code path that
 * submits it from the first press — that is the property the tests pin down, because the
 * failure mode here is silent (a mis-wired first button voids a real match with no warning).
 */
export function StartNewMatch({ action }: { action: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button
        type="button"
        onClick={() => setArmed(true)}
        className="w-full"
      >
        Start new match
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <form action={action}>
        <Confirming onCancel={() => setArmed(false)} />
      </form>
    </div>
  );
}

/**
 * Kept at module level rather than nested inside StartNewMatch: a component declared inside
 * another is a new component type on every render, so React unmounts and remounts the whole
 * subtree each time the parent re-renders.
 *
 * Separate from the parent because `useFormStatus` only reports on a form ABOVE it in the
 * tree, so this has to sit inside the <form> to see it at all.
 *
 * Both controls disappear together while the request is in flight. Cancel previously sat
 * outside the form and stayed live during the void: pressing it reverted the screen to the
 * un-armed state, telling the player nothing had happened, while the match was voided anyway.
 * A control that can no longer stop the action must not remain on screen implying it can.
 */
function Confirming({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();

  return (
    <div className="space-y-3">
      <p className={pending ? 'py-3 text-center font-bold' : ''} aria-live="polite">
        {pending ? 'Starting a new match…' : ''}
      </p>
      {!pending ? (
        <>
          <StatusMessage tone="error" title="Start over?">
            This will void the unfinished match and its unrecorded chip result.
          </StatusMessage>
          <Button type="submit" variant="destructive" className="w-full">
            Yes, void it and start new
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            className="w-full"
          >
            Cancel
          </Button>
        </>
      ) : null}
    </div>
  );
}
